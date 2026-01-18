// src/domain/vibration/vibrationController.js
import eventTypes from '../../core/eventTypes.js'

export class VibrationController {
  #logger
  #vibrationBus
  #mainBus
  #clock
  #controllerId

  constructor({ logger, vibrationBus, mainBus, clock, controllerId }) {
    this.#logger = logger
    this.#vibrationBus = vibrationBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'vibrationController'
  }

  start() {
    throw new Error('not implemented')
  }

  dispose() {
    throw new Error('not implemented')
  }

  _logger() {
    return this.#logger
  }

  _vibrationBus() {
    return this.#vibrationBus
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

  _publishHit({ level, sensorId }) {
    const event = {
      type: eventTypes.vibration.hit,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: { level, sensorId },
    }

    this.#logger.debug('event_publish', event)
    this.#mainBus.publish(event)
  }
}

export default VibrationController
