// src/devices/protocols/virt/virtualBinaryInput.js
/**
 * Protocol: virtual binary input
 *
 * Contract:
 * - subscribe(handler) -> unsubscribe
 * - set(value:boolean) drives a change and notifies subscribers (if changed)
 *
 * @example
 * const inp = new VirtualBinaryInput(false)
 * inp.subscribe((v) => console.log(v))
 * inp.set(true)
 */

export default class VirtualBinaryInput {
  #value
  #handlers

  constructor(initial = false) {
    this.#value = Boolean(initial)
    this.#handlers = new Set()
  }

  subscribe(handler) {
    this.#handlers.add(handler)

    return () => {
      this.#handlers.delete(handler)
    }
  }

  set(value) {
    const next = Boolean(value)
    if (next === this.#value) {
      return
    }

    this.#value = next

    for (const h of this.#handlers) {
      h(next)
    }
  }

  dispose() {
    this.#handlers.clear()
  }
}
