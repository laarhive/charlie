// src/devices/protocols/usbSerial/usbSerialDuplex.js
import { SerialPort } from 'serialport'

export default class UsbSerialDuplex {
  #port
  #handlers
  #disposed
  #onError

  #path
  #options

  constructor({ path, options, onError }) {
    this.#port = null
    this.#handlers = new Set()
    this.#disposed = false
    this.#onError = typeof onError === 'function' ? onError : null

    this.#path = path
    this.#options = options
  }

  subscribe(handler) {
    if (this.#disposed) return () => {}

    this.#handlers.add(handler)

    if (this.#handlers.size === 1) {
      this.#attach()
    }

    return () => {
      this.#handlers.delete(handler)

      if (this.#handlers.size === 0) {
        this.#detach()
      }
    }
  }

  write(buf) {
    if (this.#disposed || !this.#port) return { ok: false, error: 'SERIAL_NOT_OPEN' }

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)

    try {
      this.#port.write(b)
      return { ok: true }
    } catch (e) {
      this.#emitError(e)
      return { ok: false, error: 'SERIAL_WRITE_FAILED' }
    }
  }

  dispose() {
    if (this.#disposed) return

    this.#disposed = true
    this.#handlers.clear()
    this.#detach()
  }

  #attach() {
    if (this.#port) return

    const port = new SerialPort({
      path: this.#path,
      autoOpen: false,
      ...this.#options,
    })

    this.#port = port

    port.on('error', (e) => this.#emitError(e))
    port.on('data', (data) => this.#onData(data))

    port.open((err) => {
      if (err) {
        this.#emitError(err)
      }
    })
  }

  #detach() {
    if (!this.#port) return

    const port = this.#port
    this.#port = null

    try {
      port.removeAllListeners('data')
      port.removeAllListeners('error')

      if (port.isOpen) {
        port.close(() => {})
      }
    } catch (e) {
      this.#emitError(e)
    }
  }

  #onData(data) {
    if (this.#disposed) return

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)

    for (const h of this.#handlers) {
      h(buf)
    }
  }

  #emitError(e) {
    if (!this.#onError) return

    this.#onError({
      source: 'usbSerial',
      message: e?.message || String(e),
    })
  }
}
