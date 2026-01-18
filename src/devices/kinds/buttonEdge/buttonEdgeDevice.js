// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'

/**
 * Device kind: buttonEdge
 *
 * Input:
 * - Binary input port (pressed => true)
 *
 * Output (domain bus):
 * - `buttonRaw:edge` payload: { deviceId, publishAs, edge: 'press' }
 *
 * Core semantics:
 * - device.coreRole is not used here (controller forwards it to main bus)
 *
 * Commands (inject):
 * - { type: 'press', ms?: number }
 *   Only supported if the protocol input is settable (virt).
 *
 * @example
 * const d = new ButtonEdgeDevice({ logger, clock, domainBus, device, protocolFactory })
 * d.start()
 */
export default class ButtonEdgeDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #device
  #protocolFactory

  #input
  #unsub
  #last
  #blocked

  constructor({ logger, clock, domainBus, device, protocolFactory }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#device = device
    this.#protocolFactory = protocolFactory

    this.#input = null
    this.#unsub = null
    this.#last = null
    this.#blocked = false
  }

  start() {
    if (this.#blocked) {
      return
    }

    if (!this.#input) {
      this.#input = this.#protocolFactory.makeBinaryInput(this.#device.protocol)
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
  }

  dispose() {
    this.block()

    if (this.#input?.dispose) {
      this.#input.dispose()
    }

    this.#input = null
  }

  block() {
    this.#blocked = true

    if (this.#unsub) {
      this.#unsub()
      this.#unsub = null
    }

    this.#last = null
  }

  unblock() {
    this.#blocked = false

    // Recreate protocol every unblock to support manual recovery
    if (this.#input?.dispose) {
      this.#input.dispose()
    }

    this.#input = null
    this.#unsub = null
    this.start()
  }

  inject(raw) {
    let cmd = raw

    if (typeof raw === 'string') {
      const s = raw.trim()

      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          cmd = JSON.parse(s)
        } catch {
          // keep as string
          cmd = s
        }
      } else {
        cmd = s
      }
    }

    // Support both string shorthand and JSON shape
    // - "press 200"
    // - "press"
    // - { "type": "press", "ms": 200 }
    if (typeof cmd === 'string') {
      const parts = cmd.split(/\s+/).filter(Boolean)
      const name = parts[0]

      if (name !== 'press') {
        const err = new Error('unsupported_command')
        err.code = 'NOT_SUPPORTED'
        throw err
      }

      const ms = Number(parts[1])
      const holdMs = Number.isNaN(ms) ? 30 : Math.max(1, ms)

      return this.#injectPress(holdMs)
    }

    if (cmd && typeof cmd === 'object') {
      if (cmd.type !== 'press') {
        const err = new Error('unsupported_command')
        err.code = 'NOT_SUPPORTED'
        throw err
      }

      const holdMs = Number(cmd.ms) > 0 ? Number(cmd.ms) : 30
      return this.#injectPress(holdMs)
    }

    const err = new Error('unsupported_command')
    err.code = 'NOT_SUPPORTED'
    throw err
  }

  #injectPress(holdMs) {
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

    this.#logger?.debug?.('event_publish', {
      bus: this.#device.domain,
      type: domainEventTypes.button.edge,
      deviceId,
      publishAs,
    })
  }
}
