// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
/**
 * Button edge device.
 *
 * Purpose:
 * - Converts a binary input protocol into semantic "button pressed" domain events
 *
 * Behavior:
 * - Emits a domain button edge only on rising transitions
 * - Suppresses duplicate presses while the input remains HIGH
 * - Reports hardware health via system:hardware events on the main bus
 *
 * Protocol requirements:
 * - Must provide a binary input with:
 *   - subscribe(callback)
 *   - optional set(value) for injection
 *   - optional dispose()
 *
 * Runtime states emitted:
 * - active          → input is functioning
 * - degraded        → protocol error occurred
 * - manualBlocked   → device was blocked by user or config
 *
 * Injection:
 * - Supported commands:
 *   - "press"
 *   - "press <ms>"
 *   - { type: "press", ms: number }
 *
 * Injection simulates a press by toggling the protocol input HIGH → LOW.
 *
 * Error handling:
 * - Protocol errors are deduplicated in time
 * - Errors do not crash the device
 * - Degraded state is reported once per distinct failure
 *
 * Domain output:
 * - Emits domainEventTypes.button.edge
 *
 * System output:
 * - Emits eventTypes.system.hardware
 *
 * @example
 * device.inject('press 100')
 *
 * @example
 * device.inject({ type: 'press', ms: 50 })
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

    if (!this.#mainBus?.publish) {
      throw new Error('buttonEdge requires main bus for system:hardware reporting')
    }
  }

  _startImpl() {
    if (!this.#input) {
      this._setLastError(null)

      this.#input = this.#protocolFactory.makeBinaryInput(this._device().protocol, {
        onError: (e) => {
          const msg = String(e?.message || '')
          const now = this.#clock.nowMs()

          const duplicate = msg &&
            msg === this.#lastProtocolErrorMsg &&
            (now - this.#lastProtocolErrorTs) < 2000

          this.#lastProtocolErrorMsg = msg
          this.#lastProtocolErrorTs = now

          this._setLastError(msg || 'gpio_error')

          if (!duplicate) {
            this.#logger.error('device_protocol_error', {
              deviceId: this.getId(),
              source: e?.source,
              message: e?.message,
            })
          }

          this.#publishHardwareState('degraded', this.getLastError())
        }
      })
    }

    if (this.#unsub) {
      return
    }

    this.#last = null

    this.#unsub = this.#input.subscribe((value) => {
      const v = Boolean(value)

      if (!this.isBlocked() && v === true && this.#last !== true) {
        this.#publishPress()
      }

      this.#last = v
    })

    this.#publishHardwareState('active', null)
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

    // Only publish manualBlocked if it was a manual action (not dispose)
    if (reason !== 'dispose') {
      const msg = reason ? `blocked: ${String(reason)}` : 'blocked'
      this.#publishHardwareState('manualBlocked', msg)
    }
  }

  inject(payload) {
    let cmd = payload

    if (typeof payload === 'string') {
      const s = payload.trim()

      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          cmd = JSON.parse(s)
        } catch {
          cmd = s
        }
      } else {
        cmd = s
      }
    }

    let holdMs = 30

    if (typeof cmd === 'string') {
      const parts = cmd.split(/\s+/).filter(Boolean)
      const name = parts[0]

      if (name !== 'press') {
        return err(deviceErrorCodes.notSupported, 'unsupported_command', { cmd: name })
      }

      const ms = Number(parts[1])
      holdMs = Number.isNaN(ms) ? 30 : Math.max(1, ms)
    } else if (cmd && typeof cmd === 'object') {
      if (cmd.type !== 'press') {
        return err(deviceErrorCodes.notSupported, 'unsupported_command', { cmd: cmd.type })
      }

      holdMs = Number(cmd.ms) > 0 ? Number(cmd.ms) : 30
    } else {
      return err(deviceErrorCodes.notSupported, 'unsupported_command')
    }

    this.start()

    if (typeof this.#input?.set !== 'function') {
      return err(deviceErrorCodes.notSupported, 'inject_requires_settable_input')
    }

    this.#input.set(true)

    setTimeout(() => {
      this.#input.set(false)
    }, holdMs)

    return ok()
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

  #publishPress() {
    this.#domainBus.publish({
      type: domainEventTypes.button.edge,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        deviceId: this.getId(),
        publishAs: this.getPublishAs(),
        edge: 'press',
      },
    })
  }
}
