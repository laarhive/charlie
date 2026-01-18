// src/hw/gpio/gpioWatchdog.js
import eventTypes from '../../../../core/eventTypes.js'
import Gpio from '../../../../gpio/gpio.js'

export class GpioWatchdog {
  #logger
  #bus
  #clock
  #mode

  #outLine
  #inLine

  #toggleMs
  #staleMs

  #out
  #inp

  #disposed
  #staleTimer

  #lastStatus
  #lastError
  #lastErrorCode

  #level
  #bias

  #gpioOpts

  constructor({
                logger,
                bus,
                clock,
                mode,
                outLine = 17,
                inLine = 27,
                toggleMs = 1000,
                bias = Gpio.PULL_DOWN,

                chip = null,
                binDir = null,
                gpiomonPath = null,
                gpiosetPath = null,
                gpioinfoPath = null,
                pkillPath = null,

                // Watchdog should always label itself consistently
                consumerTag = 'charlie',
                reclaimOnBusy = true,
              }) {
    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#mode = mode

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

    this.#staleMs = (2 * this.#toggleMs) + 200

    this.#out = null
    this.#inp = null

    this.#disposed = false
    this.#staleTimer = null

    this.#lastStatus = 'unknown'
    this.#lastError = null
    this.#lastErrorCode = null

    this.#level = 0
    this.#bias = bias

    this.#gpioOpts = {
      logger: this.#logger,
      clock: this.#clock,
      chip: chip ?? undefined,
      binDir: binDir ?? undefined,
      gpiomonPath: gpiomonPath ?? undefined,
      gpiosetPath: gpiosetPath ?? undefined,
      gpioinfoPath: gpioinfoPath ?? undefined,
      pkillPath: pkillPath ?? undefined,
      consumerTag,
      reclaimOnBusy,
    }
  }

  start() {
    if (this.#disposed) return

    if (this.#mode !== 'hw') {
      this.#publish('skipped', `mode=${this.#mode}`)
      return
    }

    this.#out = new Gpio(this.#outLine, { ...this.#gpioOpts, mode: Gpio.OUTPUT })
    this.#inp = new Gpio(this.#inLine, {
      ...this.#gpioOpts,
      mode: Gpio.INPUT,
      pullUpDown: this.#bias,
      edge: Gpio.EITHER_EDGE,
    })

    this.#inp.on('interrupt', () => {
      this.#armStaleTimer()
      this.#publish('ok', null)
    })

    this.#inp.on('error', ({ source, message }) => {
      this.#clearStaleTimer()
      this.#publish('degraded', `${source}: ${message}`)
    })

    this.#armStaleTimer()
    this.#publish('degraded', 'no loopback edge observed yet')

    this.#startToggling()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    this.#clearStaleTimer()

    if (this.#inp) {
      this.#inp.dispose()
      this.#inp = null
    }

    if (this.#out) {
      this.#out.dispose()
      this.#out = null
    }
  }

  #startToggling() {
    let backoffMs = 250

    const tick = () => {
      if (this.#disposed) return

      this.#level = this.#level === 0 ? 1 : 0

      try {
        this.#out.digitalWrite(this.#level)
        backoffMs = 250
      } catch (e) {
        const msg = `write failed: ${String(e?.message || e)}`
        this.#publish('degraded', msg)

        const waitMs = Math.min(backoffMs, 5000)
        backoffMs = Math.min(backoffMs * 2, 5000)

        setTimeout(() => {
          tick()
        }, waitMs)

        return
      }

      setTimeout(() => {
        tick()
      }, this.#toggleMs)
    }

    tick()
  }

  #armStaleTimer() {
    this.#clearStaleTimer()

    this.#staleTimer = setTimeout(() => {
      this.#staleTimer = null
      if (this.#disposed) return

      this.#publish('degraded', `loopback stale (no edge for ${this.#staleMs}ms)`)
    }, this.#staleMs)
  }

  #clearStaleTimer() {
    if (!this.#staleTimer) return
    clearTimeout(this.#staleTimer)
    this.#staleTimer = null
  }

  #classifyError(message) {
    const s = String(message || '').toLowerCase()

    if (s.includes('device or resource busy') || s.includes('resource busy') || s.includes('busy')) return 'busy'
    if (s.includes('permission denied') || s.includes('operation not permitted')) return 'permission'
    if (s.includes('no such file') || s.includes('not found')) return 'not_found'
    if (s.includes('invalid argument') || s.includes('unknown option') || s.includes('unrecognized option')) return 'invalid_args'
    if (s.includes('already requested') || s.includes('line is requested') || s.includes('requested by')) return 'line_requested'

    return 'unknown'
  }

  #publish(status, error = null) {
    const nextError = error || null
    const nextErrorCode = nextError ? this.#classifyError(nextError) : null

    const changed =
      status !== this.#lastStatus ||
      nextError !== this.#lastError ||
      nextErrorCode !== this.#lastErrorCode

    if (!changed) return

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
          outLine: this.#outLine,
          inLine: this.#inLine,
          toggleMs: this.#toggleMs,
          staleMs: this.#staleMs,
          consumerTag: this.#gpioOpts.consumerTag,
          reclaimOnBusy: this.#gpioOpts.reclaimOnBusy,
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
}

export default GpioWatchdog
