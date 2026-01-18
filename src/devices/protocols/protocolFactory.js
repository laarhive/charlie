// src/devices/protocols/protocolFactory.js
import VirtualBinaryInput from './virt/virtualBinaryInput.js'
import GpioBinaryInputGpio from './gpio/gpioBinaryInputGpio.js'

export default class ProtocolFactory {
  #logger
  #clock
  #config

  constructor({ logger, clock, config }) {
    this.#logger = logger
    this.#clock = clock
    this.#config = config
  }

  makeBinaryInput(protocol, { onError } = {}) {
    const p = protocol || {}
    const t = String(p?.type || '').trim()

    if (t === 'virt') {
      return new VirtualBinaryInput(p?.initial === true)
    }

    if (t === 'gpio') {
      return new GpioBinaryInputGpio({
        line: p?.line,
        chip: p?.chip ?? this.#config?.gpio?.chip ?? 'gpiochip0',
        activeHigh: p?.activeHigh !== false,

        pull: p?.pull ?? p?.bias ?? 'as-is',
        edge: p?.edge ?? 'either',

        consumerTag: p?.consumerTag ?? 'charlie',
        reclaimOnBusy: p?.reclaimOnBusy !== false,

        logger: this.#logger,
        clock: this.#clock,

        binDir: p?.binDir ?? undefined,
        gpiomonPath: p?.gpiomonPath ?? undefined,
        gpiosetPath: p?.gpiosetPath ?? undefined,
        gpioinfoPath: p?.gpioinfoPath ?? undefined,
        pkillPath: p?.pkillPath ?? undefined,

        onError,
      })
    }

    throw new Error(`unsupported_protocol_type:${t || 'missing'}`)
  }
}
