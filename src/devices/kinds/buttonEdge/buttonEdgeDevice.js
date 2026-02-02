// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
/**
 * Button edge device.
 *
 * Purpose:
 * - Converts a binary input protocol into raw button edge domain events
 *
 * Behavior:
 * - Emits a domain button edge on every binary transition:
 *   - rising  (LOW → HIGH)
 *   - falling (HIGH → LOW)
 * - Does not apply debounce, cooldown, long-press, or any other interpretation
 * - Reports hardware health via system:hardware events on the main bus
 *
 * Protocol requirements:
 * - Must provide a binary input with:
 *   - subscribe(callback)
 *   - optional dispose()
 *
 * Runtime states emitted:
 * - active          → input is functioning
 * - degraded        → protocol error occurred
 * - manualBlocked   → device was blocked by user or config
 *
 * External input suppression:
 * - When manualBlocked, protocol input is suppressed and must not emit domain events
 *
 * Injection:
 * - Device-native payload only (no command parsing):
 *   - { edge: 'rising' } | { edge: 'falling' }
 * - Injection is always allowed regardless of device state (active/manualBlocked/degraded)
 * - Injection must not perform hardware IO when manualBlocked
 * - Injection may emit domain events when manualBlocked (device-specific; this device does)
 *
 * Error handling:
 * - Malformed payloads return { ok:false, error:'INVALID_INJECT_PAYLOAD' }
 * - Protocol errors are deduplicated in time
 * - Errors do not crash the device
 * - Degraded state is reported once per distinct failure
 *
 * Domain output:
 * - Emits domainEventTypes.button.edge with payload.edge = 'rising' | 'falling'
 *
 * System output:
 * - Emits eventTypes.system.hardware
 *
 * @example
 * device.inject({ edge: 'rising' })
 *
 * @example
 * device.inject({ edge: 'falling' })
 */

import eventTypes from '../../../core/eventTypes.js'
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'
import deviceErrorCodes from '../../deviceErrorCodes.js'
import { ok, err } from '../../deviceResult.js'

export default class ButtonEdgeDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #mainBus
  #protocolFactory

  #input
  #unsub
  #last

  #lastProtocolErrorMsg
  #lastProtocolErrorTs

  #runtimeState

  constructor({ logger, clock, domainBus, mainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#mainBus = mainBus
    this.#protocolFactory = protocolFactory

    this.#input = null
    this.#unsub = null
    this.#last = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    this.#runtimeState = 'unknown'

    if (!this.#mainBus?.publish) {
      throw new Error('buttonEdge requires main bus for system:hardware reporting')
    }
  }

  _startImpl() {
    if (this.isBlocked() || this.isDisposed()) return

    if (!this.#input) {
      this._setLastError(null)

      this.#input = this.#protocolFactory.makeBinaryInput(this._device().protocol, {
        onError: (e) => this.#onProtocolError(e),
      })
    }

    if (this.#unsub) {
      // Already running
      if (this.#runtimeState !== 'active') {
        this.#setRuntimeState('active', null)
      }

      return
    }

    const initial = this._device()?.protocol?.initial
    this.#last = (initial === true || initial === false) ? Boolean(initial) : null

    this.#unsub = this.#input.subscribe((value) => this.#onValue(value))

    this.#setRuntimeState('active', null)
  }

  _stopImpl(reason) {
    if (this.#unsub) {
      this.#unsub()
      this.#unsub = null
    }

    this.#last = null

    if (this.#input?.dispose) {
      this.#input.dispose()
    }

    this.#input = null

    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    if (reason !== 'dispose') {
      const msg = reason ? `blocked: ${String(reason)}` : 'blocked'
      this.#runtimeState = 'manualBlocked'
      this._setLastError(msg)
      this.#publishHardwareState('manualBlocked', msg)
    }
  }

  inject(payload) {
    if (!payload || typeof payload !== 'object') {
      return err(deviceErrorCodes.invalidInjectPayload)
    }

    const edge = payload.edge
    if (edge !== 'rising' && edge !== 'falling') {
      return err(deviceErrorCodes.invalidInjectPayload)
    }

    this.#publishEdge(edge)
    return ok()
  }

  #onValue(value) {
    const v = Boolean(value)

    // Suppress domain emission while blocked, but keep tracking the last level.
    if (this.isBlocked() || this.isDisposed()) {
      this.#last = v
      return
    }

    // If we were degraded previously, treat incoming values as recovery.
    if (this.#runtimeState !== 'active') {
      this.#setRuntimeState('active', null)
    }

    const prev = this.#last

    if (prev === null) {
      this.#last = v
      return
    }

    if (v !== prev) {
      const edge = v ? 'rising' : 'falling'
      this.#publishEdge(edge)
    }

    this.#last = v
  }

  #onProtocolError(e) {
    const msg = String(e?.message || '')
    const now = this.#clock.nowMs()

    const duplicate = msg &&
      msg === this.#lastProtocolErrorMsg &&
      (now - this.#lastProtocolErrorTs) < 2000

    this.#lastProtocolErrorMsg = msg
    this.#lastProtocolErrorTs = now

    const errMsg = msg || 'binary_input_error'
    this._setLastError(errMsg)

    if (!duplicate) {
      this.#logger?.error?.('device_protocol_error', {
        deviceId: this.getId(),
        source: e?.source,
        message: e?.message,
      })
    }

    if (!this.isBlocked() && !this.isDisposed()) {
      this.#setRuntimeState('degraded', errMsg)
    }
  }

  #setRuntimeState(state, error) {
    this.#runtimeState = state
    this._setLastError(error || null)
    this.#publishHardwareState(state, this.getLastError())
  }

  #publishHardwareState(state, error) {
    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        state,
        detail: error ? { error } : {},
      },
    })
  }

  #publishEdge(edge) {
    this.#domainBus.publish({
      type: domainEventTypes.button.edge,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        edge,
      },
    })
  }
}
