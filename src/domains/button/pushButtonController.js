/**
 * Base class for button domain controllers.
 *
 * Domain controllers:
 * - consume raw button events from the button domain bus
 * - emit semantic button events on the main bus
 *
 * This base class only provides the semantic publish helper.
 *
 * @example
 * class MyController extends PushButtonController {
 *   start() {}
 * }
 */

// src/domains/button/pushButtonController.js
import eventTypes from '../../core/eventTypes.js'

export default class PushButtonController {
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
    this.#controllerId = controllerId
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

  _publishPress({ coreRole, deviceId, publishAs }) {
    const payload = {
      coreRole: coreRole ?? null,
      deviceId: deviceId ?? null,
      publishAs: publishAs ?? null,

      /* Backward compatibility for any existing core logic */
      sensorId: publishAs ?? deviceId ?? null,
    }

    const event = {
      type: eventTypes.button.press,
      ts: this.#clock.nowMs(),
      source: 'buttonController',
      payload,
    }

    this.#logger.debug('event_publish', { bus: 'main', event })
    this.#mainBus.publish(event)
  }
}
