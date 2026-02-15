// src/devices/kinds/ld2450Radar/ld2450RadarDevice.js
import eventTypes from '../../../core/eventTypes.js'
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'
import deviceErrorCodes from '../../deviceErrorCodes.js'
import { ok, err } from '../../deviceResult.js'
import { createLd2450StreamDecoder } from './ld2450Decode.js'
import usbSerialErrorCodes from '../../protocols/usbSerial/usbSerialErrorCodes.js'
import { makeStreamKey } from '../../../core/eventBus.js'
import { busIds } from '../../../app/buses.js'
import isPlainObject from '../../../utils/isPlainObject.js'

export default class Ld2450RadarDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #mainBus
  #protocolFactory

  #serialPath
  #duplex
  #unsubData
  #unsubStatus

  #lastProtocolErrorMsg
  #lastProtocolErrorTs

  #decoder
  #decoderOnFrame
  #decoderOnError

  #watchdogTimer
  #lastDataTs
  #dataTimeoutMs
  #runtimeState

  constructor({ logger, clock, domainBus, mainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#mainBus = mainBus
    this.#protocolFactory = protocolFactory

    this.#serialPath = null
    this.#duplex = null
    this.#unsubData = null
    this.#unsubStatus = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    this.#watchdogTimer = null
    this.#lastDataTs = 0
    this.#dataTimeoutMs = Number(this._device()?.protocol?.dataTimeoutMs) || 1500
    this.#runtimeState = 'unknown'

    if (!this.#mainBus?.publish) {
      throw new Error('ld2450Radar requires main bus for system:hardware reporting')
    }

    this.#decoder = createLd2450StreamDecoder({
      validRule: 'resolution',
      maxBufferBytes: 8192,
      emitStats: false,
      nowMs: () => this.#clock.nowMs(),
    })

    this.#decoderOnFrame = (frame) => {
      if (this.isBlocked()) return
      this.#publishFrame(frame)
    }

    this.#decoderOnError = (e) => {
      this.#logger?.error?.('ld2450_decode_error', {
        deviceId: this.getId(),
        code: e?.code,
        message: e?.message,
        droppedBytes: e?.droppedBytes,
        count: e?.count,
      })
    }

    this.#decoder.on('frame', this.#decoderOnFrame)
    this.#decoder.on('error', this.#decoderOnError)

    const initialPath = String(this._device()?.protocol?.serialPath || '').trim()
    if (initialPath) {
      this.rebind({ serialPath: initialPath })
    }
  }

  get streamKeyWho() { return this.getId() }

  rebind({ serialPath }) {
    const sp = serialPath === null ? null : String(serialPath || '').trim()
    this.#serialPath = sp && sp.length > 0 ? sp : null

    this.#teardown()

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

    this.#unsubData = this.#duplex.subscribeData((buf) => this.#onData(buf))
    this.#unsubStatus = this.#duplex.subscribeStatus((evt) => this.#onLinkStatus(evt))

    this.#lastDataTs = this.#clock.nowMs()
    this.#startWatchdog()

    void this.#openLink()
  }

  _stopImpl(reason) {
    this.#teardown()

    if (reason !== 'dispose') {
      const msg = reason ? `blocked: ${String(reason)}` : 'blocked'
      this.#runtimeState = 'manualBlocked'
      this._setLastError(msg)
      this.#publishHardwareState('manualBlocked', msg)
    }
  }

  inject(payload) {
    if (isPlainObject(payload?.frame)) {
      this.#publishFrame(payload?.frame)
      return ok()
    }

    return err(deviceErrorCodes.invalidInjectPayload)
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

    // Link is ready, but radar is considered active only once data arrives.
    if (this.#runtimeState !== 'active') {
      this.#setRuntimeState('degraded', 'link_ready')
    }
  }

  #onLinkStatus(evt) {
    if (this.isBlocked() || this.isDisposed()) return

    const t = String(evt?.type || '')

    if (t === 'open') {
      // Treat open as link_ready; do not flip to active until data arrives.
      if (this.#runtimeState !== 'active') {
        this.#setRuntimeState('degraded', 'link_ready')
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

  #onData(buf) {
    if (this.isBlocked()) return

    this.#lastDataTs = this.#clock.nowMs()

    if (this.#runtimeState !== 'active') {
      this.#setRuntimeState('active', null)
    }

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    this.#decoder.push(b)
  }

  #publishFrame(frame) {
    const publishTs = this.#clock.nowMs()

    const frameTs = Number(frame?.ts)
    const measTs = (Number.isFinite(frameTs) && frameTs > 0) ? frameTs : publishTs

    this.#domainBus.publish({
      type: domainEventTypes.presence.ld2450,
      ts: publishTs,
      source: 'ld2450RadarDevice',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: domainEventTypes.presence.ld2450,
        where: busIds.presence,
      }),
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        // No HW timestamp exists for LD2450. measTs is the decoder's frame completion time.
        measTs,
        frame,
      },
    })
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

  #startWatchdog() {
    if (this.#watchdogTimer) return

    const interval = Math.min(250, Math.max(100, Math.floor(this.#dataTimeoutMs / 4)))

    this.#watchdogTimer = setInterval(() => {
      this.#tickWatchdog()
    }, interval)
  }

  #stopWatchdog() {
    if (!this.#watchdogTimer) return

    clearInterval(this.#watchdogTimer)
    this.#watchdogTimer = null
  }

  #tickWatchdog() {
    if (this.isBlocked() || this.isDisposed()) return
    if (!this.#duplex) return

    const now = this.#clock.nowMs()
    const age = now - this.#lastDataTs

    if (age > this.#dataTimeoutMs) {
      if (this.#runtimeState !== 'degraded') {
        this.#setRuntimeState('degraded', `no_data_${this.#dataTimeoutMs}ms`)
      }
    }
  }

  #setRuntimeState(state, error) {
    this.#runtimeState = state
    this._setLastError(error || null)
    this.#publishHardwareState(state, this.getLastError())
  }

  #teardown() {
    this.#stopWatchdog()

    if (this.#unsubData) {
      this.#unsubData()
      this.#unsubData = null
    }

    if (this.#unsubStatus) {
      this.#unsubStatus()
      this.#unsubStatus = null
    }

    if (this.#duplex) {
      void this.#duplex.close()
      this.#duplex.dispose()
    }

    this.#duplex = null

    if (this.#decoder?.reset) {
      this.#decoder.reset()
    }

    this.#lastDataTs = 0
    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0
  }

  #publishHardwareState(state, error) {
    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'ld2450RadarDevice',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.system.hardware,
        where: busIds.main,
      }),
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        state,
        detail: error ? { error } : {},
      },
    })
  }
}
