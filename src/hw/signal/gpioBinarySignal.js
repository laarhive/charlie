// src/hw/signal/gpioBinarySignal.js

/**
 * GPIO-backed binary signal (RPi).
 *
 * Contract:
 * - read() -> boolean
 * - subscribe(handler) -> unsubscribe
 *
 * Not implemented in dev environment yet.
 *
 * @example
 * const s = new GpioBinarySignal({ pin: 17, activeHigh: true })
 * const unsub = s.subscribe((v) => console.log('pin', v))
 */
export class GpioBinarySignal {
  constructor() {
    throw new Error('GpioBinarySignal not implemented yet. Use VirtualBinarySignal in sim/dev.')
  }
}

export default GpioBinarySignal
