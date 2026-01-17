import domainEventTypes from '../../domain/domainEventTypes.js'

/**
 * GPIO button driver.
 * Publishes raw edge press events to button bus.
 *
 * No short/long here (controller handles it later if needed).
 *
 * @example
 * const d = new GpioButtonDriver({ logger, buttonBus, clock, sensor, signal })
 * d.start()
 */
export class GpioButtonDriver {
  #logger
  #buttonBus
  #clock
  #sensor
  #signal
  #unsubscribe
  #started
  #enabled
  #last

  constructor({ logger, buttonBus, clock, sensor, signal }) {
    this.#logger = logger
    this.#buttonBus = buttonBus
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
    return 'button'
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

      // Rising edge => press
      if (v === true && this.#last !== true) {
        this.#publishPress()
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

  #publishPress() {
    if (!this.#enabled) {
      this.#logger.debug('driver_publish_skipped', { sensorId: this.#sensor.id, kind: 'press' })
      return
    }

    const logicalId = this.#sensor.publishAs ?? this.#sensor.id

    const event = {
      type: domainEventTypes.button.edge,
      ts: this.#clock.nowMs(),
      source: 'gpioButtonDriver',
      payload: {
        sensorId: logicalId,
        edge: 'press',
      },
    }

    this.#logger.debug('event_publish', { bus: 'button', event })
    this.#buttonBus.publish(event)
  }
}

export default GpioButtonDriver
