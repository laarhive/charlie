// src/devices/protocols/usbSerial/usbSerialDuplex.js
import { SerialPort } from 'serialport'
import usbSerialErrorCodes from './usbSerialErrorCodes.js'

export default class UsbSerialDuplex {
  #path
  #options
  #onError

  #port
  #state
  #disposed

  #dataHandlers
  #statusHandlers

  #shouldBeOpen
  #reconnectTimer
  #reconnectAttempt
  #reconnectMinMs
  #reconnectMaxMs
  #openTimeoutMs

  constructor({ path, options, onError }) {
    this.#path = String(path || '').trim()
    this.#options = options || {}
    this.#onError = typeof onError === 'function' ? onError : null

    this.#port = null
    this.#state = 'closed'
    this.#disposed = false

    this.#dataHandlers = new Set()
    this.#statusHandlers = new Set()

    this.#shouldBeOpen = false
    this.#reconnectTimer = null
    this.#reconnectAttempt = 0

    const minMs = Number(this.#options?.reconnectMinMs)
    const maxMs = Number(this.#options?.reconnectMaxMs)
    const openMs = Number(this.#options?.openTimeoutMs)

    this.#reconnectMinMs = Number.isFinite(minMs) && minMs > 0 ? minMs : 250
    this.#reconnectMaxMs = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 5000
    this.#openTimeoutMs = Number.isFinite(openMs) && openMs > 0 ? openMs : 1500
  }

  getState() {
    return this.#state
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
    if (this.#disposed) return { ok: false, error: usbSerialErrorCodes.disposed }
    if (!this.#path) return { ok: false, error: usbSerialErrorCodes.serialPathMissing }

    this.#shouldBeOpen = true
    this.#clearReconnectTimer()

    if (this.#state === 'open') return { ok: true }
    if (this.#state === 'opening') return { ok: true }

    return this.#openOnce()
  }

  async close() {
    if (this.#disposed) return { ok: true }

    this.#shouldBeOpen = false
    this.#clearReconnectTimer()

    if (!this.#port) {
      this.#setState('closed')
      return { ok: true }
    }

    await this.#closePort()
    return { ok: true }
  }

  async write(buf) {
    if (this.#disposed) return { ok: false, error: usbSerialErrorCodes.disposed }
    if (!this.#port || this.#state !== 'open' || !this.#port.isOpen) {
      return { ok: false, error: usbSerialErrorCodes.serialNotOpen }
    }

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)

    try {
      await new Promise((resolve, reject) => {
        this.#port.write(b, (err) => {
          if (err) return reject(err)

          this.#port.drain((err2) => {
            if (err2) return reject(err2)
            resolve()
          })
        })
      })

      return { ok: true }
    } catch (e) {
      const msg = e?.message || String(e)
      this.#emitError(msg)
      this.#emitStatus({ type: 'error', error: msg })
      return { ok: false, error: usbSerialErrorCodes.serialWriteFailed }
    }
  }

  dispose() {
    if (this.#disposed) return

    this.#disposed = true
    this.#shouldBeOpen = false
    this.#clearReconnectTimer()

    this.#dataHandlers.clear()
    this.#statusHandlers.clear()

    void this.close()
    this.#setState('disposed')
  }

  async #openOnce() {
    if (this.#disposed) return { ok: false, error: usbSerialErrorCodes.disposed }
    if (this.#port) return { ok: true }

    this.#setState('opening')

    const port = new SerialPort({
      path: this.#path,
      autoOpen: false,
      ...this.#options,
    })

    this.#port = port

    port.on('data', (data) => this.#onData(data))
    port.on('error', (e) => this.#onPortError(e))
    port.on('close', () => this.#onPortClose())

    const openRes = await Promise.race([
      new Promise((resolve) => {
        port.open((err) => {
          if (err) {
            resolve({ ok: false, kind: 'failed', error: err?.message || String(err) })
            return
          }

          resolve({ ok: true })
        })
      }),
      new Promise((resolve) => {
        setTimeout(() => resolve({ ok: false, kind: 'timeout' }), this.#openTimeoutMs)
      }),
    ])

    if (!openRes.ok) {
      const code = openRes.kind === 'timeout'
        ? usbSerialErrorCodes.serialOpenTimeout
        : usbSerialErrorCodes.serialOpenFailed

      const msg = openRes.kind === 'timeout'
        ? `serial_open_timeout_${this.#openTimeoutMs}ms`
        : (openRes.error || usbSerialErrorCodes.serialOpenFailed)

      this.#emitError(msg)
      this.#emitStatus({ type: 'error', error: msg })

      await this.#closePort()

      this.#setState('closed')

      if (this.#shouldBeOpen) {
        this.#scheduleReconnect()
      }

      return { ok: false, error: code }
    }

    this.#reconnectAttempt = 0
    this.#setState('open')
    this.#emitStatus({ type: 'open' })

    return { ok: true }
  }

  async #closePort() {
    const port = this.#port
    if (!port) return

    this.#port = null
    this.#setState('closing')

    try {
      port.removeAllListeners('data')
      port.removeAllListeners('error')
      port.removeAllListeners('close')

      if (port.isOpen) {
        await new Promise((resolve) => {
          port.close(() => resolve())
        })
      }
    } catch (e) {
      const msg = e?.message || String(e)
      this.#emitError(msg)
      this.#emitStatus({ type: 'error', error: msg })
    }

    this.#setState('closed')
    this.#emitStatus({ type: 'close' })
  }

  #onData(data) {
    if (this.#disposed) return

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)

    for (const h of this.#dataHandlers) {
      try {
        h(buf)
      } catch {
        // ignore
      }
    }
  }

  #onPortError(e) {
    const msg = e?.message || String(e)
    this.#emitError(msg)
    this.#emitStatus({ type: 'error', error: msg })
  }

  #onPortClose() {
    if (this.#disposed) return

    this.#setState('closed')
    this.#emitStatus({ type: 'close' })

    if (this.#shouldBeOpen) {
      this.#scheduleReconnect()
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer) return
    if (this.#disposed) return
    if (!this.#shouldBeOpen) return

    this.#reconnectAttempt += 1

    const base = this.#reconnectMinMs
    const max = this.#reconnectMaxMs
    const pow = Math.min(8, this.#reconnectAttempt)
    const delay = Math.min(max, base * (2 ** pow))

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null

      if (!this.#shouldBeOpen || this.#disposed) return
      void this.#openOnce()
    }, delay)
  }

  #clearReconnectTimer() {
    if (!this.#reconnectTimer) return
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
    this.#reconnectAttempt = 0
  }

  #setState(s) {
    this.#state = s
  }

  #emitStatus(evt) {
    for (const h of this.#statusHandlers) {
      try {
        h(evt)
      } catch {
        // ignore
      }
    }
  }

  #emitError(message) {
    if (!this.#onError) return

    this.#onError({
      source: 'usbSerial',
      message: String(message || 'usb_serial_error'),
    })
  }
}
