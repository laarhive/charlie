// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
import eventTypes from '../../../core/eventTypes.js'
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'

export default class ButtonEdgeDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #mainBus
  #device
  #protocolFactory

  #input
  #unsub
  #last
  #blocked

  #lastError
  #lastProtocolErrorMsg
  #lastProtocolErrorTs

  constructor({ logger, clock, domainBus, mainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#mainBus = mainBus
    this.#device = device
    this.#protocolFactory = protocolFactory

    this.#input = null
    this.#unsub = null
    this.#last = null
    this.#blocked = false

    this.#lastError = null
    this.#lastProtocolErrorMsg = null
    this.#lastProtocolErrorTs = 0

    if (!this.#mainBus?.publish) {
      throw new Error('buttonEdge requires main bus for system:hardware reporting')
    }
  }

  start() {
    if (this.#blocked) {
      return
    }

    if (!this.#input) {
      this.#lastError = null

      this.#input = this.#protocolFactory.makeBinaryInput(this.#device.protocol, {
        onError: (e) => {
          const msg = String(e?.message || '')
          const now = this.#clock.nowMs()

          const duplicate = msg &&
            msg === this.#lastProtocolErrorMsg &&
            (now - this.#lastProtocolErrorTs) < 2000

          this.#lastProtocolErrorMsg = msg
          this.#lastProtocolErrorTs = now

          this.#lastError = msg || 'gpio_error'

          if (!duplicate) {
            this.#logger.error('device_protocol_error', {
              deviceId: this.#device.id,
              source: e?.source,
              message: e?.message,
            })
          }

          this.#publishHardwareState('degraded', this.#lastError)
        }
      })
    }

    if (this.#unsub) {
      return
    }

    this.#last = null

    this.#unsub = this.#input.subscribe((value) => {
      const v = Boolean(value)

      if (!this.#blocked && v === true && this.#last !== true) {
        this.#publishPress()
      }

      this.#last = v
    })

    this.#publishHardwareState('active', null)
  }

  dispose() {
    this.block()

    if (this.#input?.dispose) {
      this.#input.dispose()
    }

    this.#input = null
  }

  block(reason) {
    this.#blocked = true

    if (this.#unsub) {
      this.#unsub()
      this.#unsub = null
    }

    this.#last = null

    this.#publishHardwareState('manualBlocked', reason ? `blocked: ${reason}` : 'blocked')
  }

  unblock() {
    this.#blocked = false

    if (this.#input?.dispose) {
      this.#input.dispose()
    }

    this.#input = null
    this.#unsub = null
    this.start()
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
        const err = new Error('unsupported_command')
        err.code = 'NOT_SUPPORTED'
        throw err
      }

      const ms = Number(parts[1])
      holdMs = Number.isNaN(ms) ? 30 : Math.max(1, ms)
    } else if (cmd && typeof cmd === 'object') {
      if (cmd.type !== 'press') {
        const err = new Error('unsupported_command')
        err.code = 'NOT_SUPPORTED'
        throw err
      }

      holdMs = Number(cmd.ms) > 0 ? Number(cmd.ms) : 30
    } else {
      const err = new Error('unsupported_command')
      err.code = 'NOT_SUPPORTED'
      throw err
    }

    if (!this.#input) {
      this.start()
    }

    if (typeof this.#input?.set !== 'function') {
      const err = new Error('inject_requires_settable_input')
      err.code = 'NOT_SUPPORTED'
      throw err
    }

    this.#input.set(true)

    setTimeout(() => {
      this.#input.set(false)
    }, holdMs)
  }

  getSnapshot() {
    return {
      id: this.#device.id,
      publishAs: this.#device.publishAs ?? this.#device.id,
      kind: this.#device.kind ?? null,
      domain: this.#device.domain ?? null,
      configuredState: this.#device.state ?? 'active',
      blocked: this.#blocked,
      lastError: this.#lastError,
    }
  }

  #publishHardwareState(state, error) {
    const deviceId = this.#device.id
    const publishAs = this.#device.publishAs ?? deviceId

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        deviceId,
        publishAs,
        state,
        detail: error ? { error } : {},
      },
    })
  }

  #publishPress() {
    const deviceId = this.#device.id
    const publishAs = this.#device.publishAs ?? deviceId

    this.#domainBus.publish({
      type: domainEventTypes.button.edge,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        deviceId,
        publishAs,
        edge: 'press',
      },
    })
  }
}
