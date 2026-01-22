// src/devices/kinds/ld2450Radar/ld2450RadarDevice.js
import eventTypes from '../../../core/eventTypes.js'
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'
import deviceErrorCodes from '../../deviceErrorCodes.js'
import { ok, err } from '../../deviceResult.js'
import { createLd2450StreamDecoder } from './ld2450Decode.js'

export default class Ld2450RadarDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #mainBus
  #protocolFactory

  #serialPath
  #duplex
  #unsub

  #lastProtocolErrorMsg
  #lastProtocolErrorTs
  #decoder

  constructor({ logger, clock, domainBus, mainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#mainBus = mainBus
    this.#protocolFactory = protocolFactory

    this.#serialPath = null
    this.#duplex = null
    this.#unsub = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    if (!this.#mainBus?.publish) {
      throw new Error('ld2450Radar requires main bus for system:hardware reporting')
    }

    const initialPath = String(this._device()?.protocol?.serialPath || '').trim()
    if (initialPath) {
      this.rebind({ serialPath: initialPath })
    }

    this.#decoder = createLd2450StreamDecoder({
      validRule: 'resolution',
      includeRaw: false,
      maxBufferBytes: 8192,
      emitStats: false,
    })

    this.#decoder.on('frame', (frame) => {
      // frame.targets: 3 targets, each has xMm/yMm/speedCms/resolutionMm/valid
      // frame.present: boolean
      console.log(frame.present, frame.targets[0])
    })

    this.#decoder.on('error', (e) => {
      console.warn('ld2450 decode:', e)
    })

  }

  rebind({ serialPath }) {
    const sp = serialPath === null ? null : String(serialPath || '').trim()
    this.#serialPath = sp && sp.length > 0 ? sp : null

    this.#teardown()

    if (this.#serialPath === null) {
      this._setLastError('usb_missing')
      this.#publishHardwareState('degraded', this.getLastError())
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
      this._setLastError('usb_missing')
      this.#publishHardwareState('degraded', this.getLastError())
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

    this.#unsub = this.#duplex.subscribe((buf) => this.#onData(buf))

    this.#publishHardwareState('active', null)
  }

  _stopImpl(reason) {
    this.#teardown()

    if (reason !== 'dispose') {
      const msg = reason ? `blocked: ${String(reason)}` : 'blocked'
      this.#publishHardwareState('manualBlocked', msg)
    }
  }

  inject(payload) {
    if (!payload) return err(deviceErrorCodes.invalidInjectPayload)

    if (Buffer.isBuffer(payload)) {
      this.#publishRaw(payload)
      return ok()
    }

    if (typeof payload === 'object') {
      const b64 = payload.base64
      if (typeof b64 === 'string' && b64.length > 0) {
        try {
          const buf = Buffer.from(b64, 'base64')
          this.#publishRaw(buf)
          return ok()
        } catch {
          return err(deviceErrorCodes.invalidInjectPayload)
        }
      }
    }

    return err(deviceErrorCodes.invalidInjectPayload)
  }

  #onData(buf) {
    if (this.isBlocked()) return

    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    this.#decoder.push(b)
    //this.#publishRaw(b)
  }



  #publishRaw(buf) {
    this.#domainBus.publish({
      type: domainEventTypes.presence.ld2450,
      ts: this.#clock.nowMs(),
      source: 'ld2450RadarDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        base64: buf.toString('base64'),
        bytes: buf.length,
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

    this._setLastError(msg || 'usb_serial_error')

    if (!duplicate) {
      this.#logger?.error?.('device_protocol_error', {
        deviceId: this.getId(),
        source: e?.source,
        message: e?.message,
      })
    }

    this.#publishHardwareState('degraded', this.getLastError())
  }

  #teardown() {
    if (this.#unsub) {
      this.#unsub()
      this.#unsub = null
    }

    if (this.#duplex?.dispose) {
      this.#duplex.dispose()
    }

    this.#duplex = null
  }

  #publishHardwareState(state, error) {
    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'ld2450RadarDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        state,
        detail: error ? { error } : {},
      },
    })
  }
}
