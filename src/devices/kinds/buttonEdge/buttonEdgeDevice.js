// src/devices/kinds/buttonEdge/buttonEdgeDevice.js
import BaseDevice from '../../base/baseDevice.js'
import domainEventTypes from '../../../domains/domainEventTypes.js'

export default class ButtonEdgeDevice extends BaseDevice {
  #logger
  #clock
  #buttonBus
  #device
  #input

  #enabled
  #last
  #unsub

  constructor({ logger, clock, buttonBus, device, input }) {
    super(device)

    this.#logger = logger
    this.#clock = clock
    this.#buttonBus = buttonBus
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
    this.#buttonBus.publish({
      type: domainEventTypes.button.edge,
      ts: this.#clock.nowMs(),
      source: 'buttonEdgeDevice',
      payload: {
        sensorId: this.#device.publishAs ?? this.#device.id,
        edge: 'press',
      },
    })
  }
}
