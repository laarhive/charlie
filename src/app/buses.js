// src/app/buses.js
import EventBus from '../core/eventBus.js'

/**
 * Creates the main bus + domain buses.
 *
 * @example
 * const buses = makeBuses()
 */
export const makeBuses = function makeBuses() {
  return {
    main: new EventBus(),
    presence: new EventBus(),
    vibration: new EventBus(),
    button: new EventBus(),
    led: new EventBus(),
    tasker: new EventBus(),
  }
}

export default makeBuses
