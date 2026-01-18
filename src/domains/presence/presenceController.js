// src/domain/presence/presenceController.js
import eventTypes from '../../core/eventTypes.js'

export class PresenceController {
  #logger
  #presenceBus
  #mainBus
  #clock
  #controllerId

  constructor({ logger, presenceBus, mainBus, clock, controllerId }) {
    this.#logger = logger
    this.#presenceBus = presenceBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'presenceController'
  }

  /**
   * Starts the controller (subscribe to presenceBus).
   *
   * @example
   * controller.start()
   */
  start() {
    throw new Error('not implemented')
  }

  /**
   * Disposes the controller (unsubscribe).
   *
   * @example
   * controller.dispose()
   */
  dispose() {
    throw new Error('not implemented')
  }

  /* protected-ish helpers */

  _logger() {
    return this.#logger
  }

  _presenceBus() {
    return this.#presenceBus
  }

  _mainBus() {
    return this.#mainBus
  }

  _clock() {
    return this.#clock
  }

  _controllerId() {
    return this.#controllerId
  }

  _publishEnter({ zone, sensorId }) {
    const event = {
      type: eventTypes.presence.enter,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: { zone, sensorId },
    }

    this.#logger.debug('event_publish', event)
    this.#mainBus.publish(event)
  }

  _publishExit({ zone, sensorId }) {
    const event = {
      type: eventTypes.presence.exit,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: { zone, sensorId },
    }

    this.#logger.debug('event_publish', event)
    this.#mainBus.publish(event)
  }
}

export default PresenceController
