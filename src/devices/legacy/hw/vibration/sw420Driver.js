import domainEventTypes from '../../../../domains/domainEventTypes.js'

/**
 * SW-420 driver.
 * Publishes raw vibration hit events to vibration bus.
 *
 * No cooldown here (domain controller handles it).
 *
 * @example
 * const d = new Sw420Driver({ logger, vibrationBus, clock, sensor, signal })
 * d.start()
 */
export class Sw420Driver {
  #logger
  #vibrationBus
  #clock
  #sensor
  #signal
  #unsubscribe
  #started
  #enabled
  #last

  constructor({ logger, vibrationBus, clock, sensor, signal }) {
    this.#logger = logger
    this.#vibrationBus = vibrationBus
    this.#clock = clock
    this.#sensor = sensor
    this.#signal = signal

    this.#unsubscribe = null
    this.#started = false
    this.#enabled = true
    this.#last = null
  }

  getSensorId() {
    return this.#sensor.id
  }

  getType() {
    return this.#sensor.type
  }

  getRole() {
    return this.#sensor.role
  }

  getBus() {
    return 'vibration'
  }

  isEnabled() {
    return this.#enabled
  }

  setEnabled(enabled) {
    this.#enabled = Boolean(enabled)
    this.#logger.notice('driver_enabled_changed', { sensorId: this.#sensor.id, enabled: this.#enabled })
  }

  start() {
    if (this.#started) {
      return
    }

    this.#started = true
    this.#last = null

    this.#unsubscribe = this.#signal.subscribe((value) => {
      const v = Boolean(value)

      // Rising edge triggers a hit
      if (v === true && this.#last !== true) {
        this.#publishHit()
      }

      this.#last = v
    })

    this.#logger.notice('driver_started', { sensorId: this.#sensor.id, type: this.#sensor.type, role: this.#sensor.role })
  }

  dispose() {
    if (!this.#started) {
      return
    }

    this.#started = false

    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    this.#logger.notice('driver_disposed', { sensorId: this.#sensor.id })
  }

  isStarted() {
    return this.#started
  }

  #publishHit() {
    if (!this.#enabled) {
      this.#logger.debug('driver_publish_skipped', { sensorId: this.#sensor.id, kind: 'hit' })
      return
    }

    const event = {
      type: domainEventTypes.vibration.hit,
      ts: this.#clock.nowMs(),
      source: 'sw420Driver',
      payload: {
        sensorId: this.#sensor.id,
      },
    }

    this.#logger.debug('event_publish', { bus: 'vibration', event })
    this.#vibrationBus.publish(event)
  }
}

export default Sw420Driver
