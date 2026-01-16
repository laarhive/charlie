// src/hw/gpio/gpioWatchdog.js
import { spawn } from 'node:child_process'
import eventTypes from '../../core/eventTypes.js'

let processSignalsBound = false

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

  #timer
  #disposed

  #lastEdgeTs
  #lastStatus
  #lastError
  #lastErrorCode

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

    this.#timer = null
    this.#disposed = false

    this.#lastEdgeTs = null
    this.#lastStatus = 'unknown'
    this.#lastError = null
    this.#lastErrorCode = null

    this.#restartBackoffMs = 500
    this.#restartScheduled = false
  }

  start() {
    if (!processSignalsBound) {
      this.#bindProcessSignalsOnce()
      processSignalsBound = true
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
    if (this.#disposed) {
      return
    }

    this.#disposed = true

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    this.#stopProcesses()
  }

  #bindProcessSignalsOnce() {
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

  #classifyError(message) {
    const s = String(message || '').toLowerCase()

    if (s.includes('device or resource busy') || s.includes('resource busy') || s.includes('busy')) {
      return 'busy'
    }

    if (s.includes('permission denied') || s.includes('operation not permitted')) {
      return 'permission'
    }

    if (s.includes('no such file') || s.includes('not found')) {
      return 'not_found'
    }

    if (s.includes('invalid argument') || s.includes('unknown option') || s.includes('unrecognized option')) {
      return 'invalid_args'
    }

    if (s.includes('already requested') || s.includes('line is requested') || s.includes('requested by')) {
      return 'line_requested'
    }

    return 'unknown'
  }

  #publish(status, error = null) {
    const nextError = error || null
    const nextErrorCode = nextError ? this.#classifyError(nextError) : null

    const changed =
      status !== this.#lastStatus ||
      nextError !== this.#lastError ||
      nextErrorCode !== this.#lastErrorCode

    if (!changed) {
      return
    }

    this.#lastStatus = status
    this.#lastError = nextError
    this.#lastErrorCode = nextErrorCode

    this.#bus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'gpioWatchdog',
      payload: {
        subsystem: 'gpio',
        mode: this.#mode,
        status,
        error: nextError,
        errorCode: nextErrorCode,
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
      this.#logger.error('gpio_watchdog_degraded', { error: nextError, errorCode: nextErrorCode })
      return
    }

    if (status === 'ok') {
      this.#logger.notice('gpio_watchdog_ok', {})
      return
    }

    this.#logger.notice('gpio_watchdog_status', { status, error: nextError, errorCode: nextErrorCode })
  }

  #tick() {
    if (this.#disposed || this.#mode !== 'hw') {
      return
    }

    if (!this.#gpiomon || !this.#gpioset) {
      this.#publish('degraded', 'gpio watchdog process missing')
      this.#scheduleRestart()
      return
    }

    const now = this.#clock.nowMs()

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
    // Fresh health requirement on each (re)spawn
    this.#lastEdgeTs = null

    // Start monitor first, then toggler
    this.#startMonitor()
    this.#startToggler()
  }

  #isProcessGroupAlive(pid) {
    if (!pid) return false

    try {
      process.kill(-pid, 0)
      return true
    } catch (e) {
      return false
    }
  }

  #killProcessGroup(p) {
    if (!p || !p.pid) return

    const pid = p.pid

    try {
      process.kill(-pid, 'SIGTERM')
    } catch (e) {
      if (e?.code !== 'ESRCH') {
        this.#logger.error('gpio_watchdog_kill_failed', { pid, error: String(e?.message || e) })
      }
      return
    }

    setTimeout(() => {
      if (this.#disposed) {
        return
      }

      if (!this.#isProcessGroupAlive(pid)) {
        return
      }

      try {
        process.kill(-pid, 'SIGKILL')
      } catch (e) {
        if (e?.code !== 'ESRCH') {
          this.#logger.error('gpio_watchdog_kill_force_failed', { pid, error: String(e?.message || e) })
        }
      }
    }, 600)
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
    // gpiomon -c <chip> --num-events=0 <line>
    //
    // NOTE: do NOT use --silent, otherwise we cannot observe edges via stdout.
    const args = [
      '-c',
      this.#chip,
      '--num-events=0',
      String(this.#inLine),
    ]

    const p = spawn('/usr/bin/gpiomon', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })

    this.#gpiomon = p

    let outBuf = ''
    let errBuf = ''

    p.stdout.on('data', (d) => {
      outBuf += d.toString('utf8')

      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() || ''

      if (lines.length > 0) {
        this.#lastEdgeTs = this.#clock.nowMs()
        this.#resetBackoff()
      }
    })

    p.stderr.on('data', (d) => {
      errBuf += d.toString('utf8')
      if (errBuf.length > 32_768) {
        errBuf = errBuf.slice(-16_384)
      }
    })

    p.on('error', (err) => {
      this.#gpiomon = null
      this.#publish('degraded', `gpiomon failed: ${err.message}`)
      this.#scheduleRestart()
    })

    p.on('exit', (code, signal) => {
      this.#gpiomon = null

      const msg = errBuf.trim()
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

    // Continuous square wave using a repeating toggle sequence:
    // gpioset -t A,B repeats A,B forever (unless last period is 0)
    const args = [
      '-c',
      this.#chip,
      '-t',
      `${this.#toggleMs},${this.#toggleMs}`,
      `${this.#outLine}=1`,
    ]

    const p = spawn('/usr/bin/gpioset', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true
    })

    this.#gpioset = p

    let errBuf = ''

    p.stderr.on('data', (d) => {
      errBuf += d.toString('utf8')
      if (errBuf.length > 32_768) {
        errBuf = errBuf.slice(-16_384)
      }
    })

    p.on('error', (err) => {
      this.#gpioset = null
      this.#publish('degraded', `gpioset failed: ${err.message}`)
      this.#scheduleRestart()
    })

    p.on('exit', (code, signal) => {
      this.#gpioset = null

      const msg = errBuf.trim()
        ? errBuf.trim()
        : `gpioset exited (code=${code}, signal=${signal})`

      this.#publish('degraded', msg)
      this.#scheduleRestart()
    })
  }
}

export default GpioWatchdog
