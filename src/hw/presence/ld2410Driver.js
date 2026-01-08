// src/hw/presence/ld2410Driver.js
import domainEventTypes from '../../domain/domainEventTypes.js'

/**
 * LD2410 driver (binary output).
 *
 * Reads a binary signal and publishes raw presence events to the presence domain bus:
 * - type: domainEventTypes.presence.binary
 * - payload: { sensorId, zone, present }
 *
 * No debounce/hysteresis here. That belongs in BinaryPresenceController.
 *
 * @example
 * const driver = new Ld2410Driver({ logger, presenceBus, clock, sensor, signal })
 * driver.start()
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

  constructor({ logger, presenceBus, clock, sensor, signal }) {
    this.#logger = logger
    this.#presenceBus = presenceBus
    this.#clock = clock
    this.#sensor = sensor
    this.#signal = signal

    this.#unsubscribe = null
    this.#started = false
    this.#last = null
  }

  /**
   * Starts reading the signal and publishing raw domain events.
   *
   * @example
   * driver.start()
   */
  start() {
    if (this.#started) {
      return
    }

    this.#started = true
    this.#last = Boolean(this.#signal.read())

    this.#publish(this.#last)

    this.#unsubscribe = this.#signal.subscribe((value) => {
      const v = Boolean(value)
      if (v === this.#last) {
        return
      }

      this.#last = v
      this.#publish(v)
    })

    this.#logger.notice('driver_started', { sensorId: this.#sensor.id, type: this.#sensor.type, role: this.#sensor.role })
  }

  /**
   * Stops and cleans up.
   *
   * @example
   * driver.dispose()
   */
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

  #publish(present) {
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
