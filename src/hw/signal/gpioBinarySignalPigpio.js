// src/hw/signal/gpioBinarySignalPigpio.js
import { Gpio } from 'pigpio'

/**
 * GPIO-backed binary signal implementation using pigpio.
 *
 * PLATFORM:
 * - Linux only
 * - Requires pigpio daemon or direct hardware access
 *
 * CONTRACT:
 * - read() -> boolean
 * - subscribe(handler) -> unsubscribe
 *
 * FEATURES:
 * - Edge-triggered callbacks (no polling)
 * - Optional glitch filtering (microseconds)
 * - Logical inversion via activeHigh flag
 *
 * IMPORTANT:
 * This module imports native bindings and MUST only be loaded on Linux.
 * It is intentionally isolated behind createGpioBinarySignal.linux.js.
 *
 * @example
 * const sig = new GpioBinarySignalPigpio({
 *   line: 17,
 *   activeHigh: true,
 *   glitchFilterUs: 8000,
 * })
 *
 * const unsub = sig.subscribe((value) => {
 *   console.log('GPIO changed:', value)
 * })
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
    this.#gpio.removeAllListeners('alert')
  }

  /* concise private helper */

  #toLogical(raw) {
    return this.#activeHigh ? Boolean(raw) : !Boolean(raw)
  }
}

export default GpioBinarySignalPigpio
