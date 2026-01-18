// src/hw/signal/virtualBinarySignal.js

/**
 * Virtual binary signal for tests/dev.
 *
 * Contract:
 * - read() -> boolean
 * - subscribe(handler) -> unsubscribe
 *
 * Extra:
 * - set(value) to drive changes
 *
 * @example
 * const s = new VirtualBinarySignal(false)
 * const unsub = s.subscribe((v) => console.log('changed', v))
 * s.set(true)
 * unsub()
 */
export class VirtualBinarySignal {
  #value
  #handlers

  constructor(initial = false) {
    this.#value = Boolean(initial)
    this.#handlers = new Set()
  }

  /**
   * Reads current value.
   *
   * @returns {boolean}
   *
   * @example
   * const v = s.read()
   */
  read() {
    return this.#value
  }

  /**
   * Subscribes to changes.
   *
   * @param {(value: boolean) => void} handler
   * @returns {() => void}
   *
   * @example
   * const unsub = s.subscribe((v) => console.log(v))
   */
  subscribe(handler) {
    this.#handlers.add(handler)

    return () => {
      this.#handlers.delete(handler)
    }
  }

  /**
   * Sets a new value and notifies subscribers if changed.
   *
   * @param {boolean} value
   *
   * @example
   * s.set(false)
   */
  set(value) {
    const next = Boolean(value)
    if (next === this.#value) {
      return
    }

    this.#value = next

    for (const h of this.#handlers) {
      h(this.#value)
    }
  }

  /**
   * Clears subscribers.
   *
   * @example
   * s.dispose()
   */
  dispose() {
    this.#handlers.clear()
  }
}

export default VirtualBinarySignal
