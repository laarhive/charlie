// test/devices/shared/fakeUsbSerialDuplex.js
import usbSerialErrorCodes from '../../../src/devices/protocols/usbSerial/usbSerialErrorCodes.js'

export default class FakeUsbSerialDuplex {
  #dataHandlers
  #statusHandlers
  #disposed
  #isOpen

  #openQueue
  #writes

  constructor({ openResults } = {}) {
    this.#dataHandlers = new Set()
    this.#statusHandlers = new Set()
    this.#disposed = false
    this.#isOpen = false

    this.#openQueue = Array.isArray(openResults) ? [...openResults] : []
    this.#writes = []
  }

  getState() {
    if (this.#disposed) return 'disposed'
    if (this.#isOpen) return 'open'
    return 'closed'
  }

  subscribeData(handler) {
    if (this.#disposed) return () => {}
    if (typeof handler !== 'function') return () => {}

    this.#dataHandlers.add(handler)

    return () => {
      this.#dataHandlers.delete(handler)
    }
  }

  subscribeStatus(handler) {
    if (this.#disposed) return () => {}
    if (typeof handler !== 'function') return () => {}

    this.#statusHandlers.add(handler)

    return () => {
      this.#statusHandlers.delete(handler)
    }
  }

  async open() {
    if (this.#disposed) {
      return { ok: false, error: usbSerialErrorCodes.disposed }
    }

    const next = this.#openQueue.length > 0 ? this.#openQueue.shift() : { ok: true }

    if (next && next.ok === false) {
      const error = next.error || usbSerialErrorCodes.serialOpenFailed
      this.#emitStatusAsync({ type: 'error', error })
      return { ok: false, error }
    }

    // IMPORTANT: emit 'open' asynchronously to avoid recursion with device open handlers.
    this.#isOpen = true
    this.#emitStatusAsync({ type: 'open' })
    return { ok: true }
  }

  async close() {
    if (this.#disposed) return { ok: true }

    if (this.#isOpen) {
      this.#isOpen = false
      this.#emitStatusAsync({ type: 'close' })
    }

    return { ok: true }
  }

  async write(buf) {
    if (this.#disposed) return { ok: false, error: usbSerialErrorCodes.disposed }
    if (!this.#isOpen) return { ok: false, error: usbSerialErrorCodes.serialNotOpen }

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    this.#writes.push(b)

    return { ok: true }
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#dataHandlers.clear()
    this.#statusHandlers.clear()
    this.#isOpen = false
  }

  // ---- test helpers ----

  getWrites() {
    return [...this.#writes]
  }

  emitData(buf) {
    if (this.#disposed) return

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)

    for (const h of this.#dataHandlers) {
      h(b)
    }
  }

  emitStatus(evt) {
    if (this.#disposed) return
    this.#emitStatusAsync(evt)
  }

  enqueueOpenResult(result) {
    this.#openQueue.push(result)
  }

  #emitStatusAsync(evt) {
    // setImmediate keeps ordering deterministic and prevents sync re-entrancy loops.
    setImmediate(() => {
      if (this.#disposed) return

      for (const h of this.#statusHandlers) {
        h(evt)
      }
    })
  }
}
