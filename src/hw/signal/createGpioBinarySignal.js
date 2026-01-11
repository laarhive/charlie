import GpioBinarySignalPigpio from './gpioBinarySignalPigpio.js'
import GpioBinarySignalGpiod from './gpioBinarySignalGpiod.js'

/**
 * Creates a GPIO-backed binary signal for the chosen backend.
 *
 * @example
 * const sig = createGpioBinarySignal({ backend: 'pigpio', chip: 'gpiochip0', line: 17, activeHigh: true })
 */
export const createGpioBinarySignal = function createGpioBinarySignal({ backend, chip, line, activeHigh, glitchFilterUs }) {
  if (backend === 'gpiod') {
    return new GpioBinarySignalGpiod({ chip, line, activeHigh })
  }

  return new GpioBinarySignalPigpio({ line, activeHigh, glitchFilterUs })
}

export default createGpioBinarySignal
