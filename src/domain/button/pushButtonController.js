// src/domain/button/pushButtonController.js
import eventTypes from '../../core/eventTypes.js'

const PushButtonController = class PushButtonController {
  #logger
  #buttonBus
  #mainBus
  #clock
  #controllerId

  constructor({ logger, buttonBus, mainBus, clock, controllerId }) {
    this.#logger = logger
    this.#buttonBus = buttonBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'pushButtonController'
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

  _buttonBus() {
    return this.#buttonBus
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

  _publishPress({ sensorId }) {
    const event = {
      type: eventTypes.button.press,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: { sensorId },
    }

    this.#logger.debug('event_publish', event)
    this.#mainBus.publish(event)
  }
}

export default PushButtonController
