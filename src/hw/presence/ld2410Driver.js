// src/hw/presence/ld2410Driver.js
import domainEventTypes from '../../domains/domainEventTypes.js'

/**
 * LD2410 driver (binary output).
 *
 * Publishes raw events to presenceBus:
 * - domainEventTypes.presence.binary
 *
 * Runtime enable/disable supported via setEnabled().
 *
 * @example
 * const driver = new Ld2410Driver({ logger, presenceBus, clock, sensor, signal })
 * driver.setEnabled(false)
 */
export class Ld2410Driver {
  #logger
  #presenceBus
  #clock
  #sensor
  #signal

  #unsubscribe
  #started
  #last
  #enabled

  constructor({ logger, presenceBus, clock, sensor, signal }) {
    this.#logger = logger
    this.#presenceBus = presenceBus
    this.#clock = clock
    this.#sensor = sensor
    this.#signal = signal

    this.#unsubscribe = null
    this.#started = false
    this.#last = null
    this.#enabled = true
  }

  getSensorId() {
    return this.#sensor.id
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

    // Try to seed an initial state if the signal supports synchronous reads.
    // For edge-only signals (gpiod), read() intentionally throws and we start "unknown".
    try {
      if (this.#signal && typeof this.#signal.read === 'function') {
        this.#last = Boolean(this.#signal.read())
        this.#publish(this.#last)
      }
    } catch {
      this.#last = null
    }

    this.#unsubscribe = this.#signal.subscribe((value) => {
      const v = Boolean(value)

      if (this.#last !== null && v === this.#last) {
        return
      }

      this.#last = v
      this.#publish(v)
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

  getType() {
    return this.#sensor.type
  }

  getRole() {
    return this.#sensor.role
  }

  getBus() {
    return 'presence'
  }

  isStarted() {
    return this.#started
  }

  #publish(present) {
    if (!this.#enabled) {
      this.#logger.debug('driver_publish_skipped', { sensorId: this.#sensor.id, present: Boolean(present) })
      return
    }

    const event = {
      type: domainEventTypes.presence.binary,
      ts: this.#clock.nowMs(),
      source: 'ld2410Driver',
      payload: {
        sensorId: this.#sensor.id,
        zone: this.#sensor.zone,
        present: Boolean(present),
      },
    }

    this.#logger.debug('event_publish', { bus: 'presence', event })
    this.#presenceBus.publish(event)
  }
}

export default Ld2410Driver
