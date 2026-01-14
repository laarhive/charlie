// src/hw/gpio/gpioWatchdog.js
import { spawn } from 'node:child_process'
import eventTypes from '../../core/eventTypes.js'

export class GpioWatchdog {
  #logger
  #bus
  #clock
  #mode

  #chip
  #outLine
  #inLine

  #toggleMs
  #checkEveryMs
  #staleMs

  #gpioset
  #gpiomon
  #signalsBound

  #timer
  #disposed

  #lastEdgeTs
  #lastStatus
  #lastError

  #restartBackoffMs
  #restartScheduled

  constructor({ logger, bus, clock, mode, chip = 'gpiochip0', outLine = 17, inLine = 27, toggleMs = 1000 }) {
    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#mode = mode

    this.#chip = String(chip || 'gpiochip0')
    this.#outLine = Number(outLine)
    this.#inLine = Number(inLine)

    this.#toggleMs = Number(toggleMs)

    if (Number.isNaN(this.#outLine) || Number.isNaN(this.#inLine)) {
      throw new Error('GpioWatchdog requires numeric outLine and inLine')
    }

    if (this.#outLine === this.#inLine) {
      throw new Error('GpioWatchdog requires outLine and inLine to be different')
    }

    if (Number.isNaN(this.#toggleMs) || this.#toggleMs < 100) {
      throw new Error('GpioWatchdog requires toggleMs >= 100')
    }

    // Derive:
    // - check at least twice per toggle period, but not faster than 200ms
    // - stale after 2 missing toggles + small jitter budget
    this.#checkEveryMs = Math.max(200, Math.floor(this.#toggleMs / 2))
    this.#staleMs = (2 * this.#toggleMs) + 200

    this.#gpioset = null
    this.#gpiomon = null
    this.#signalsBound = false

    this.#timer = null
    this.#disposed = false

    this.#lastEdgeTs = null
    this.#lastStatus = 'unknown'
    this.#lastError = null

    this.#restartBackoffMs = 500
    this.#restartScheduled = false
  }

  start() {
    if (!this.#signalsBound) {
      this.#bindProcessSignals()
      this.#signalsBound = true
    }

    if (this.#disposed) {
      return
    }

    if (this.#mode !== 'hw') {
      this.#publish('skipped', `mode=${this.#mode}`)
      return
    }

    this.#startProcesses()

    this.#timer = setInterval(() => {
      this.#tick()
    }, this.#checkEveryMs)

    this.#tick()
  }

  dispose() {
    this.#disposed = true

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    this.#stopProcesses()
  }

  #bindProcessSignals() {
    const cleanup = () => {
      this.dispose()
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    process.on('SIGHUP', cleanup)
    process.on('unhandledRejection', (err) => {
      cleanup()
      this.#logger.error('gpio_watchdog_unhandled_rejection', { error: String(err?.message || err) })
    })
    process.on('uncaughtException', (err) => {
      cleanup()
      this.#logger.error('gpio_watchdog_uncaught_exception', { error: String(err?.stack || err?.message || err) })
    })
  }

  #publish(status, error = null) {
    const nextError = error || null
    const changed = status !== this.#lastStatus || nextError !== this.#lastError
    if (!changed) {
      return
    }

    this.#lastStatus = status
    this.#lastError = nextError

    this.#bus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'gpioWatchdog',
      payload: {
        subsystem: 'gpio',
        mode: this.#mode,
        status,
        error: nextError,
        loopback: {
          chip: this.#chip,
          outLine: this.#outLine,
          inLine: this.#inLine,
          toggleMs: this.#toggleMs,
          staleMs: this.#staleMs,
          checkEveryMs: this.#checkEveryMs,
        },
      },
    })

    if (status === 'degraded') {
      this.#logger.error('gpio_watchdog_degraded', { error: nextError })
      return
    }

    if (status === 'ok') {
      this.#logger.notice('gpio_watchdog_ok', {})
      return
    }

    this.#logger.notice('gpio_watchdog_status', { status, error: nextError })
  }

  #tick() {
    if (this.#disposed || this.#mode !== 'hw') {
      return
    }

    // If any process missing -> degraded + restart attempt
    if (!this.#gpiomon || !this.#gpioset) {
      this.#publish('degraded', 'gpio watchdog process missing')
      this.#scheduleRestart()
      return
    }

    const now = this.#clock.nowMs()

    // If we never saw an edge yet, we remain degraded until first edge observed
    if (this.#lastEdgeTs === null) {
      this.#publish('degraded', 'no loopback edge observed yet')
      return
    }

    const age = now - this.#lastEdgeTs
    if (age > this.#staleMs) {
      this.#publish('degraded', `loopback stale (last edge ${age}ms ago)`)
      return
    }

    this.#publish('ok', null)
  }

  #startProcesses() {
    // Start monitor first, then toggler
    this.#startMonitor()
    this.#startToggler()
  }

  #killProcessGroup(p) {
    if (!p || !p.pid) return

    try {
      process.kill(-p.pid, 'SIGTERM')
    } catch (e) {
      // ESRCH = already gone
      if (e?.code !== 'ESRCH') {
        this.#logger.error('gpio_watchdog_kill_failed', { pid: p.pid, error: String(e?.message || e) })
      }
    }
  }

  #stopProcesses() {
    if (this.#gpiomon) {
      this.#killProcessGroup(this.#gpiomon)
      this.#gpiomon = null
    }

    if (this.#gpioset) {
      this.#killProcessGroup(this.#gpioset)
      this.#gpioset = null
    }
  }

  #scheduleRestart() {
    if (this.#restartScheduled || this.#disposed) {
      return
    }

    this.#restartScheduled = true
    const delay = this.#restartBackoffMs
    this.#restartBackoffMs = Math.min(this.#restartBackoffMs * 2, 10_000)

    setTimeout(() => {
      this.#restartScheduled = false

      if (this.#disposed || this.#mode !== 'hw') {
        return
      }

      this.#stopProcesses()
      this.#startProcesses()
    }, delay)
  }

  #resetBackoff() {
    this.#restartBackoffMs = 500
  }

  #startMonitor() {
    if (this.#gpiomon || this.#disposed) {
      return
    }

    // libgpiod v2:
    // gpiomon -c <chip> --num-events=0 --silent <line>
    const args = [
      '-c',
      this.#chip,
      '--num-events=0',
      '--silent',
      String(this.#inLine),
    ]

    const p = spawn(
      '/usr/bin/gpiomon',
      args,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      }
    )
    this.#gpiomon = p

    let outBuf = ''
    let errBuf = ''

    p.stdout.on('data', (d) => {
      outBuf += d.toString('utf8')

      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() || ''

      if (lines.length > 0) {
        // Any line indicates at least one edge
        this.#lastEdgeTs = this.#clock.nowMs()
        this.#resetBackoff()
      }
    })

    // Keep stderr captured for diagnostics, but do not spam terminal
    p.stderr.on('data', (d) => {
      errBuf += d.toString('utf8')
    })

    p.on('error', (err) => {
      this.#gpiomon = null
      this.#publish('degraded', `gpiomon failed: ${err.message}`)
      this.#scheduleRestart()
    })

    p.on('exit', (code, signal) => {
      this.#gpiomon = null

      const msg = (errBuf.trim())
        ? errBuf.trim()
        : `gpiomon exited (code=${code}, signal=${signal})`

      this.#publish('degraded', msg)
      this.#scheduleRestart()
    })
  }

  #startToggler() {
    if (this.#gpioset || this.#disposed) {
      return
    }

    // Continuous square wave using toggle sequence.
    //
    // gpioset holds lines while running.
    // -t <periods...>: toggles after each period; sequence repeats.
    // If the last period is 0, gpioset exits else it repeats.
    //
    // We want continuous toggling: [toggleMs, toggleMs] repeating forever.
    const args = [
      '-c',
      this.#chip,
      '-t',
      `${this.#toggleMs},${this.#toggleMs}`,
      `${this.#outLine}=1`,
    ]

    const p = spawn(
      '/usr/bin/gpioset',
      args,
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true
      }
    )
    this.#gpioset = p

    let errBuf = ''

    // Keep stderr captured for diagnostics, but do not spam terminal
    p.stderr.on('data', (d) => {
      errBuf += d.toString('utf8')
    })

    p.on('error', (err) => {
      this.#gpioset = null
      this.#publish('degraded', `gpioset failed: ${err.message}`)
      this.#scheduleRestart()
    })

    p.on('exit', (code, signal) => {
      this.#gpioset = null

      const msg = (errBuf.trim())
        ? errBuf.trim()
        : `gpioset exited (code=${code}, signal=${signal})`

      this.#publish('degraded', msg)
      this.#scheduleRestart()
    })
  }
}

export default GpioWatchdog
