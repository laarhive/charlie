// src/hw/sources/gpioButtonSource.js
import Source from './source.js'
import eventTypes from '../../core/eventTypes.js'

export class GpioButtonSource extends Source {
  #logger
  #bus
  #clock
  #sensor
  #input

  #unsubscribe
  #isStarted
  #lastPressTs

  constructor({ logger, bus, clock, sensor, input }) {
    super()

    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#sensor = sensor
    this.#input = input

    this.#unsubscribe = null
    this.#isStarted = false
    this.#lastPressTs = null
  }

  start() {
    if (this.#isStarted) {
      return
    }

    this.#isStarted = true

    this.#unsubscribe = this.#input.subscribe((value) => {
      if (value) {
        this.#onPress()
      }
    })

    this.#logger.notice('source_started', { sensorId: this.#sensor.id, type: this.#sensor.type, role: this.#sensor.role })
  }

  dispose() {
    if (!this.#isStarted) {
      return
    }

    this.#isStarted = false

    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    this.#logger.notice('source_disposed', { sensorId: this.#sensor.id })
  }

  #onPress() {
    const now = this.#clock.nowMs()
    const cooldownMs = this.#sensor.params?.cooldownMs ?? 250

    if (this.#lastPressTs !== null) {
      const dt = now - this.#lastPressTs
      if (dt < cooldownMs) {
        return
      }
    }

    this.#lastPressTs = now

    const event = {
      type: eventTypes.button.press,
      ts: now,
      source: 'sensor',
      payload: {
        sensorId: this.#sensor.id,
      },
    }

    this.#logger.debug('event_publish', event)
    this.#bus.publish(event)
  }
}

export default GpioButtonSource
