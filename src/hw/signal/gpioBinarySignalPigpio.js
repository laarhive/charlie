import { Gpio } from 'pigpio'

/**
 * GPIO-backed binary signal using pigpio.
 *
 * Contract:
 * - read() -> boolean
 * - subscribe(handler) -> unsubscribe
 *
 * Supports optional glitch filter (microseconds).
 *
 * @example
 * const sig = new GpioBinarySignalPigpio({ line: 17, activeHigh: true, glitchFilterUs: 8000 })
 * const unsub = sig.subscribe((v) => console.log(v))
 */
export class GpioBinarySignalPigpio {
  #gpio
  #activeHigh
  #handlers
  #last

  constructor({ line, activeHigh = true, glitchFilterUs = 0 }) {
    const pin = Number(line)
    if (Number.isNaN(pin)) {
      throw new Error('GpioBinarySignalPigpio requires hw.line (BCM pin number)')
    }

    this.#activeHigh = Boolean(activeHigh)
    this.#handlers = new Set()
    this.#last = null

    this.#gpio = new Gpio(pin, {
      mode: Gpio.INPUT,
      alert: true,
    })

    const gf = Number(glitchFilterUs)
    if (!Number.isNaN(gf) && gf > 0) {
      this.#gpio.glitchFilter(gf)
    }

    this.#gpio.on('alert', (level) => {
      const logical = this.#toLogical(level === 1)

      if (this.#last === logical) {
        return
      }

      this.#last = logical

      for (const h of this.#handlers) {
        h(logical)
      }
    })
  }

  read() {
    const raw = this.#gpio.digitalRead() === 1
    return this.#toLogical(raw)
  }

  subscribe(handler) {
    this.#handlers.add(handler)

    return () => {
      this.#handlers.delete(handler)
    }
  }

  dispose() {
    this.#handlers.clear()

    // pigpio doesn't offer a full "destroy"; unexport is not applicable.
    // Removing listeners is sufficient.
    this.#gpio.removeAllListeners('alert')
  }

  #toLogical(raw) {
    return this.#activeHigh ? Boolean(raw) : !Boolean(raw)
  }
}

export default GpioBinarySignalPigpio
