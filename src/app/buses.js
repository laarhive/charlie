// src/app/buses.js
import EventBus from '../core/eventBus.js'


export const busIds = Object.freeze({
  main: 'main',
  presence: 'presence',
  vibration: 'vibration',
  button: 'button',
  led: 'led',
  tasker: 'tasker',
  presenceInternal: 'presenceInternal',
})

/**
 * Creates the main bus + domain buses.
 *
 * @example
 * const buses = makeBuses()
 */
export const makeBuses = function makeBuses() {
  return {
    main: new EventBus({ busId: busIds.main, strict: true }),

    // raw sensor domain buses
    presence: new EventBus({ busId: busIds.presence, strict: true }),
    vibration: new EventBus( { busId: busIds.vibration, strict: true }),
    button: new EventBus({ busId: busIds.button, strict: true }),
    led: new EventBus({ busId: busIds.led, strict: true }),

    // tasker control surface
    tasker: new EventBus({ busId: busIds.tasker, strict: true }),

    // derived/internal presence bus (tracking, calibration, ld2410Stable, etc.)
    presenceInternal: new EventBus({ busId: busIds.presenceInternal, strict: true }),
  }
}

export default makeBuses
