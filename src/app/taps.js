// src/app/taps.js
import BusTap from '../core/busTap.js'

/**
 * Creates bus taps (disabled by default) for debugging.
 *
 * @example
 * const taps = makeTaps({ logger, buses })
 */
export const makeTaps = function makeTaps({ logger, buses }) {
  return {
    main: new BusTap({ bus: buses.main, logger, name: 'main', enabled: false }),
    presence: new BusTap({ bus: buses.presence, logger, name: 'presence', enabled: false }),
    vibration: new BusTap({ bus: buses.vibration, logger, name: 'vibration', enabled: false }),
    button: new BusTap({ bus: buses.button, logger, name: 'button', enabled: false }),
    tasker: new BusTap({ bus: buses.tasker, logger, name: 'tasker', enabled: false }),
  }
}

export default makeTaps
