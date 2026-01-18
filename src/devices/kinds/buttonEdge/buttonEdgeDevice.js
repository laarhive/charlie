/**
 * Device kind: buttonEdge
 *
 * Input:
 * - Binary input port producing boolean levels (true means "pressed" logically)
 *
 * Output (domain bus: button):
 * - Publishes `buttonRaw:edge` on rising edge only:
 *   { payload: { sensorId, edge: 'press' } }
 *
 * Commands (inject):
 * - { type: 'press', ms?: number }
 *   Simulates a press by driving the input high then low (virt protocol only).
 *
 * Notes:
 * - No debounce/cooldown here. Domain controller is responsible.
 *
 * @example
 * const dev = new ButtonEdgeDevice({ logger, clock, buttonBus, device, input })
 * dev.start()
 */

// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'

/**
 * Device kind: buttonEdge
 *
 * Domain wiring:
 * - Publishes to the domain bus selected by device.domain (typically "button").
 *
 * Input:
 * - Binary input port producing boolean levels.
 *   Logical "pressed" must be true (protocol handles activeHigh inversion).
 *
 * Output (domain bus):
 * - Publishes `buttonRaw:edge` on rising edge only:
 *   payload: { deviceId, publishAs, edge: 'press' }
 *
 * Commands (inject):
 * - { type: 'press', ms?: number }
 *   Simulates a press by driving the input high then low (virt protocol only).
 *
 * @example
 * const dev = new ButtonEdgeDevice({ logger, clock, domainBus, device, input })
 * dev.start()
 */
export default class ButtonEdgeDevice extends BaseDevice {
  #logger
  #clock
  #domainBus
  #device
  #input

  #enabled
  #last
  #unsub

  constructor({ logger, clock, domainBus, device, input }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#domainBus = domainBus
    this.#device = device
    this.#input = input

    this.#enabled = (device.state ?? 'active') === 'active'
    this.#last = null
    this.#unsub = null
  }

  start() {
    if (this.#unsub) {
      return
    }

    this.#last = null

    this.#unsub = this.#input.subscribe((value) => {
      const v = Boolean(value)

      if (this.#enabled && v === true && this.#last !== true) {
        this.#publishPress()
      }

      this.#last = v
    })
  }

  dispose() {
    if (this.#unsub) {
      this.#unsub()
      this.#unsub = null
    }

    if (this.#input?.dispose) {
      this.#input.dispose()
    }
  }

  block() {
    this.#enabled = false
  }

  unblock() {
    this.#enabled = true
  }

  inject(command) {
    if (command?.type !== 'press') {
      const err = new Error('unsupported_command')
      err.code = 'NOT_SUPPORTED'
      throw err
    }

    const holdMs = Number(command?.ms) > 0 ? Number(command.ms) : 30

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
