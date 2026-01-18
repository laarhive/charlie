// src/devices/protocols/gpio/gpioBinaryInputGpio.js
import Gpio from '../../../gpio/gpio.js'

export default class GpioBinaryInputGpio {
  #gpio
  #handlers
  #disposed

  #activeHigh
  #interruptBridge
  #errorBridge

  constructor({
                line,
                chip = 'gpiochip0',
                activeHigh = true,

                pull = Gpio.PULL_OFF,
                edge = Gpio.EITHER_EDGE,

                consumerTag = 'charlie',
                reclaimOnBusy = true,

                logger = null,
                clock = null,

                binDir = null,
                gpiomonPath = null,
                gpiosetPath = null,
                gpioinfoPath = null,
                pkillPath = null,

                onError = null,
              }) {
    const n = Number(line)
    if (Number.isNaN(n)) {
      throw new Error('GpioBinaryInputGpio requires line (number)')
    }

    this.#activeHigh = Boolean(activeHigh)

    this.#gpio = new Gpio(n, {
      logger: logger ?? undefined,
      clock: clock ?? undefined,

      chip,
      binDir: binDir ?? undefined,
      gpiomonPath: gpiomonPath ?? undefined,
      gpiosetPath: gpiosetPath ?? undefined,
      gpioinfoPath: gpioinfoPath ?? undefined,
      pkillPath: pkillPath ?? undefined,

      consumerTag,
      reclaimOnBusy,

      mode: Gpio.INPUT,
      pullUpDown: pull,
      edge,
    })

    this.#handlers = new Set()
    this.#disposed = false

    this.#interruptBridge = null
    this.#errorBridge = null

    /* concise error forwarder */
    const errSink = typeof onError === 'function' ? onError : null

    if (errSink) {
      this.#errorBridge = (evt) => {
        errSink({
          source: evt?.source ?? 'gpio',
          message: evt?.message ?? null,
          line: n,
        })
      }

      this.#gpio.on('error', this.#errorBridge)
    }
  }

  subscribe(handler) {
    if (this.#disposed) {
      return () => {}
    }

    this.#handlers.add(handler)

    if (this.#handlers.size === 1) {
      this.#attach()
    }

    return () => {
      this.#handlers.delete(handler)

      if (this.#handlers.size === 0) {
        this.#detach()
      }
    }
  }

  dispose() {
    if (this.#disposed) {
      return
    }

    this.#disposed = true
    this.#handlers.clear()
    this.#detach()

    if (this.#errorBridge) {
      this.#gpio.off('error', this.#errorBridge)
      this.#errorBridge = null
    }

    this.#gpio.dispose()
  }

  #toLogical(level01) {
    const raw = Boolean(level01)
    return this.#activeHigh ? raw : !raw
  }

  #attach() {
    if (this.#interruptBridge) {
      return
    }

    this.#interruptBridge = ({ level }) => {
      const v = this.#toLogical(level)

      for (const h of this.#handlers) {
        h(v)
      }
    }

    this.#gpio.on('interrupt', this.#interruptBridge)
  }

  #detach() {
    if (!this.#interruptBridge) {
      return
    }

    this.#gpio.off('interrupt', this.#interruptBridge)
    this.#interruptBridge = null
  }
}
