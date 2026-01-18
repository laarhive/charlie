// src/devices/protocols/virt/virtualBinaryInput.js
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
