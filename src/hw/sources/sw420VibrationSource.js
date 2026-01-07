// src/hw/sources/sw420VibrationSource.js
import Source from './source.js'
import eventTypes from '../../core/eventTypes.js'

export class Sw420VibrationSource extends Source {
  #logger
  #bus
  #clock
  #sensor
  #input

  #unsubscribe
  #isStarted
  #lastHitTs

  constructor({ logger, bus, clock, sensor, input }) {
    super()

    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#sensor = sensor
    this.#input = input

    this.#unsubscribe = null
    this.#isStarted = false
    this.#lastHitTs = null
  }

  start() {
    if (this.#isStarted) {
      return
    }

    this.#isStarted = true

    this.#unsubscribe = this.#input.subscribe((value) => {
      if (value) {
        this.#onHit()
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

  #onHit() {
    const now = this.#clock.nowMs()
    const cooldownMs = this.#sensor.params?.cooldownMs ?? 0

    if (this.#lastHitTs !== null && cooldownMs > 0) {
      const dt = now - this.#lastHitTs
      if (dt < cooldownMs) {
        return
      }
    }

    this.#lastHitTs = now

    const event = {
      type: eventTypes.vibration.hit,
      ts: now,
      source: 'sensor',
      payload: {
        sensorId: this.#sensor.id,
        level: this.#sensor.level || this.#sensor.params?.level || 'unknown',
      },
    }

    this.#logger.debug('event_publish', event)
    this.#bus.publish(event)
  }
}

export default Sw420VibrationSource
