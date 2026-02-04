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

    // raw sensor domain buses
    presence: new EventBus(),
    vibration: new EventBus(),
    button: new EventBus(),
    led: new EventBus(),

    // tasker control surface
    tasker: new EventBus(),

    // derived/internal presence bus (tracking, calibration, ld2410Stable, etc.)
    presenceInternal: new EventBus(),
  }
}

export default makeBuses
