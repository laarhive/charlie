// src/devices/kinds/gpioWatchdogLoopback/gpioWatchdogLoopbackDevice.js
import eventTypes from '../../../core/eventTypes.js'
import Gpio from '../../../gpio/gpio.js'

/**
 * Device kind: gpioWatchdogLoopback
 *
 * Purpose:
 * - Toggles an output GPIO line and expects loopback edges on an input GPIO line.
 * - Publishes `system:hardware` when status changes.
 *
 * Domain wiring:
 * - This device publishes directly to the main bus (system events).
 * - It still uses `device.domain` for consistency; set domain: 'main' in config.
 *
 * Config fields (device):
 * - id, modes, state, kind, domain ('main')
 * - protocol (gpio options: chip, binDir, paths, consumerTag, reclaimOnBusy)
 * - params: { outLine, inLine, toggleMs, bias }
 *
 * Status:
 * - ok: loopback edges observed recently
 * - degraded: no edges observed within stale window, or IO errors
 *
 * Commands (inject):
 * - Generic payload supported, but currently no commands are implemented.
 *
 * @example
 * const d = new GpioWatchdogLoopbackDevice({ logger, clock, buses, device, protocolFactory })
 * d.start()
 */
export default class GpioWatchdogLoopbackDevice {
  #logger
  #clock
  #mainBus
  #device

  #disposed
  #blocked

  #outLine
  #inLine
  #toggleMs
  #staleMs
  #bias

  #gpioOpts

  #out
  #inp

  #staleTimer
  #level

  #lastStatus
  #lastError
  #lastErrorCode

  constructor({ logger, clock, buses, device }) {
    this.#logger = logger
    this.#clock = clock
    this.#mainBus = buses?.main
    this.#device = device

    if (!this.#mainBus?.publish) {
      throw new Error('gpioWatchdogLoopback requires buses.main')
    }

    this.#disposed = false
    this.#blocked = false

    const params = device?.params || {}
    const protocol = device?.protocol || {}

    this.#outLine = Number(params?.outLine ?? 17)
    this.#inLine = Number(params?.inLine ?? 27)
    this.#toggleMs = Number(params?.toggleMs ?? 1000)
    this.#bias = params?.bias ?? Gpio.PULL_DOWN

    if (Number.isNaN(this.#outLine) || Number.isNaN(this.#inLine)) {
      throw new Error('gpioWatchdogLoopback requires numeric outLine and inLine')
    }

    if (this.#outLine === this.#inLine) {
      throw new Error('gpioWatchdogLoopback requires outLine and inLine to be different')
    }

    if (Number.isNaN(this.#toggleMs) || this.#toggleMs < 100) {
      throw new Error('gpioWatchdogLoopback requires toggleMs >= 100')
    }

    this.#staleMs = (2 * this.#toggleMs) + 200

    const chip = protocol?.chip ?? 'gpiochip0'
    const consumerTag = protocol?.consumerTag ?? 'charlie'
    const reclaimOnBusy = protocol?.reclaimOnBusy !== false

    this.#gpioOpts = {
      logger: this.#logger,
      clock: this.#clock,
      chip,

      binDir: protocol?.binDir ?? undefined,
      gpiomonPath: protocol?.gpiomonPath ?? undefined,
      gpiosetPath: protocol?.gpiosetPath ?? undefined,
      gpioinfoPath: protocol?.gpioinfoPath ?? undefined,
      pkillPath: protocol?.pkillPath ?? undefined,

      consumerTag,
      reclaimOnBusy,
    }

    this.#out = null
    this.#inp = null

    this.#staleTimer = null
    this.#level = 0

    this.#lastStatus = 'unknown'
    this.#lastError = null
    this.#lastErrorCode = null
  }

  start() {
    if (this.#disposed || this.#blocked) {
      return
    }

    // Recreate GPIO objects on every start to allow recovery
    this.#closeGpio()

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
    if (this.#disposed) {
      return
    }

    this.#disposed = true
    this.#blocked = true

    this.#clearStaleTimer()
    this.#closeGpio()
  }

  block(reason) {
    this.#blocked = true
    this.#publish('manualBlocked', reason ? `blocked: ${reason}` : 'blocked')
    this.#clearStaleTimer()
    this.#closeGpio()
  }

  unblock() {
    this.#blocked = false
    this.start()
  }

  inject(payload) {
    // Generic injection accepted. No commands implemented yet.
    // You can later add commands like:
    // - "status"
    // - "force_degraded"
    // - "force_ok"
    void payload
  }

  #startToggling() {
    let backoffMs = 250

    const tick = () => {
      if (this.#disposed || this.#blocked) return
      if (!this.#out) return

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
      if (this.#disposed || this.#blocked) return

      this.#publish('degraded', `loopback stale (no edge for ${this.#staleMs}ms)`)
    }, this.#staleMs)
  }

  #clearStaleTimer() {
    if (!this.#staleTimer) return
    clearTimeout(this.#staleTimer)
    this.#staleTimer = null
  }

  #closeGpio() {
    if (this.#inp) {
      this.#inp.dispose()
      this.#inp = null
    }

    if (this.#out) {
      this.#out.dispose()
      this.#out = null
    }
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

    const deviceId = this.#device?.id ?? null
    const publishAs = this.#device?.publishAs ?? deviceId

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'gpioWatchdogLoopback',
      payload: {
        deviceId,
        publishAs,
        subsystem: 'gpio',
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
      this.#logger?.error?.('gpio_watchdog_degraded', { error: nextError, errorCode: nextErrorCode })
      return
    }

    if (status === 'ok') {
      this.#logger?.notice?.('gpio_watchdog_ok', {})
      return
    }

    this.#logger?.notice?.('gpio_watchdog_status', { status, error: nextError, errorCode: nextErrorCode })
  }
}
