// src/hw/io/simDigitalInput.js
import DigitalInput from './digitalInput.js'

export class SimDigitalInput extends DigitalInput {
  #value
  #handlers

  constructor({ initial = false } = {}) {
    super()
    this.#value = Boolean(initial)
    this.#handlers = new Set()
  }

  subscribe(handler) {
    this.#handlers.add(handler)

    return () => {
      this.#handlers.delete(handler)
    }
  }

  read() {
    return this.#value
  }

  /**
   * Set the input value and notify subscribers.
   *
   * @param {boolean} value
   *
   * @example
   * input.set(true)
   */
  set(value) {
    const next = Boolean(value)
    if (next === this.#value) {
      return
    }

    this.#value = next

    for (const handler of this.#handlers) {
      handler(this.#value)
    }
  }
}

export default SimDigitalInput
