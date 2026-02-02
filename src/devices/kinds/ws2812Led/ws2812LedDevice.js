// src/devices/kinds/ws2812Led/ws2812LedDevice.js
import eventTypes from '../../../core/eventTypes.js'
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'
import deviceErrorCodes from '../../deviceErrorCodes.js'
import { ok, err } from '../../deviceResult.js'
import usbSerialErrorCodes from '../../protocols/usbSerial/usbSerialErrorCodes.js'

export default class Ws2812LedDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #mainBus
  #protocolFactory

  #serialPath
  #duplex
  #unsubBus
  #unsubStatus

  #lastProtocolErrorMsg
  #lastProtocolErrorTs

  #runtimeState
  #lastRgb

  constructor({ logger, clock, domainBus, mainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#mainBus = mainBus
    this.#protocolFactory = protocolFactory

    this.#serialPath = null
    this.#duplex = null
    this.#unsubBus = null
    this.#unsubStatus = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    this.#runtimeState = 'unknown'
    this.#lastRgb = [0, 0, 0]

    if (!this.#mainBus?.publish) {
      throw new Error('ws2812Led requires main bus for system:hardware reporting')
    }

    const initialPath = String(this._device()?.protocol?.serialPath || '').trim()
    if (initialPath) {
      this.rebind({ serialPath: initialPath })
    }
  }

  rebind({ serialPath }) {
    const sp = serialPath === null ? null : String(serialPath || '').trim()
    this.#serialPath = sp && sp.length > 0 ? sp : null

    this.#teardownProtocol()

    if (this.#serialPath === null) {
      this.#setRuntimeState('degraded', 'usb_missing')
      return
    }

    if (!this.isBlocked() && !this.isDisposed()) {
      this._startImpl()
    }
  }

  _startImpl() {
    if (this.isBlocked() || this.isDisposed()) return

    this.#attachBus()

    if (this.#duplex) return

    if (!this.#serialPath) {
      this.#setRuntimeState('degraded', 'usb_missing')
      return
    }

    this._setLastError(null)

    const effectiveProtocol = {
      ...(this._device().protocol || {}),
      type: 'serial',
      serialPath: this.#serialPath,
    }

    this.#duplex = this.#protocolFactory.makeUsbSerialDuplex(effectiveProtocol, {
      onError: (e) => this.#onProtocolError(e),
    })

    this.#unsubStatus = this.#duplex.subscribeStatus((evt) => this.#onLinkStatus(evt))

    void this.#openLink()
  }

  _stopImpl(reason) {
    this.#teardownProtocol()

    if (reason !== 'dispose') {
      const msg = reason ? `blocked: ${String(reason)}` : 'blocked'
      this.#runtimeState = 'manualBlocked'
      this._setLastError(msg)
      this.#publishHardwareState('manualBlocked', msg)
    }
  }

  inject(payload) {
    if (payload === undefined || payload === null) {
      return err(deviceErrorCodes.invalidInjectPayload)
    }

    if (typeof payload !== 'object') {
      return err(deviceErrorCodes.invalidInjectPayload)
    }

    const rgb = this.#parseRgbPayload(payload)
    if (!rgb) {
      return err(deviceErrorCodes.invalidInjectPayload)
    }

    void this.#applyRgb(rgb, { source: 'inject' })
    return ok()
  }

  async #openLink() {
    if (!this.#duplex) return
    if (this.isBlocked() || this.isDisposed()) return

    const res = await this.#duplex.open()
    if (!res?.ok) {
      const reason = res.error === usbSerialErrorCodes.serialOpenTimeout
        ? 'serial_open_timeout'
        : 'serial_open_failed'
      this.#setRuntimeState('degraded', reason)
      return
    }

    this.#setRuntimeState('active', null)

    // Recovery: re-apply last known RGB (state stays active)
    await this.#writeRgb(this.#lastRgb)
    this.#publishHardwareState('active', null, { action: 'applied', rgb: this.#lastRgb, source: 'recovery' })
  }

  #onLinkStatus(evt) {
    if (this.isBlocked() || this.isDisposed()) return

    const t = String(evt?.type || '')

    if (t === 'open') {
      if (this.#runtimeState !== 'active') {
        void this.#openLink()
      }

      return
    }

    if (t === 'close') {
      this.#setRuntimeState('degraded', 'serial_closed')
      return
    }

    if (t === 'error') {
      this.#setRuntimeState('degraded', 'serial_error')
    }
  }

  #attachBus() {
    if (this.#unsubBus) return

    this.#unsubBus = this.#domainBus.subscribe((event) => {
      if (!event?.type) return
      if (event.type !== domainEventTypes.led.command) return

      this.#onLedCommand(event)
    })
  }

  #detachBus() {
    if (!this.#unsubBus) return

    this.#unsubBus()
    this.#unsubBus = null
  }

  #onLedCommand(event) {
    if (this.isDisposed()) return
    if (this.isBlocked()) return

    const p = event?.payload || {}

    if (!this.#isTargetMatch(p)) {
      return
    }

    const rgb = this.#parseRgbPayload(p)
    if (!rgb) {
      this.#logger.warning('led_invalid_command_payload', { deviceId: this.getId(), payload: p })
      return
    }

    void this.#applyRgb(rgb, { source: 'bus' })
  }

  #isTargetMatch(payload) {
    const ledId = this.#asOptId(payload?.ledId)
    const publishAs = this.#asOptId(payload?.publishAs)

    if (ledId !== null) {
      return ledId === this.getId()
    }

    if (publishAs !== null) {
      return publishAs === this.getPublishAs()
    }

    return true
  }

  async #applyRgb(rgb, { source }) {
    this.#lastRgb = rgb

    const blocked = this.isBlocked() || this.isDisposed() || this.#runtimeState !== 'active'
    if (blocked) {
      // Do not introduce new states; just report intent.
      const state = this.#runtimeState === 'manualBlocked' ? 'manualBlocked' : 'degraded'
      this.#publishHardwareState(state, this.getLastError(), { action: 'simulated', rgb, source })
      return
    }

    const okWrite = await this.#writeRgb(rgb)
    if (!okWrite) return

    // State stays active; action goes into detail.
    this.#publishHardwareState('active', null, { action: 'applied', rgb, source })
  }

  async #writeRgb(rgb) {
    if (!this.#duplex) {
      this.#setRuntimeState('degraded', 'serial_not_ready')
      return false
    }

    const buf = this.#encodeRgbCommand(rgb)
    const res = await this.#duplex.write(buf)

    if (!res?.ok) {
      const msg = res?.error || 'serial_write_failed'
      this.#setRuntimeState('degraded', msg)
      return false
    }

    return true
  }

  #encodeRgbCommand(rgb) {
    const [r, g, b] = rgb
    const line = `${r},${g},${b}\n`
    return Buffer.from(line, 'utf8')
  }

  #parseRgbPayload(payload) {
    const arr = Array.isArray(payload?.rgb) ? payload.rgb : null

    if (arr) {
      const r = this.#clampByte(arr[0])
      const g = this.#clampByte(arr[1])
      const b = this.#clampByte(arr[2])
      return [r, g, b]
    }

    if (payload && typeof payload === 'object' && ('r' in payload || 'g' in payload || 'b' in payload)) {
      const r = this.#clampByte(payload.r)
      const g = this.#clampByte(payload.g)
      const b = this.#clampByte(payload.b)
      return [r, g, b]
    }

    return null
  }

  #clampByte(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(255, Math.round(n)))
  }

  #asOptId(x) {
    const s = String(x || '').trim()
    return s.length > 0 ? s : null
  }

  #onProtocolError(e) {
    const msg = String(e?.message || '')
    const now = this.#clock.nowMs()

    const duplicate = msg &&
      msg === this.#lastProtocolErrorMsg &&
      (now - this.#lastProtocolErrorTs) < 2000

    this.#lastProtocolErrorMsg = msg
    this.#lastProtocolErrorTs = now

    const errMsg = msg || 'usb_serial_error'
    this._setLastError(errMsg)

    if (!duplicate) {
      this.#logger?.error?.('device_protocol_error', {
        deviceId: this.getId(),
        source: e?.source,
        message: e?.message,
      })
    }
  }

  #setRuntimeState(state, error) {
    this.#runtimeState = state
    this._setLastError(error || null)
    this.#publishHardwareState(state, this.getLastError())
  }

  #teardownProtocol() {
    this.#detachBus()

    if (this.#unsubStatus) {
      this.#unsubStatus()
      this.#unsubStatus = null
    }

    if (this.#duplex) {
      void this.#duplex.close()
      this.#duplex.dispose()
    }

    this.#duplex = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0
  }

  #publishHardwareState(state, error, detailExtra) {
    const detail = { ...(detailExtra || {}) }
    if (error) detail.error = error

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'ws2812LedDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        state,
        detail,
      },
    })
  }
}
