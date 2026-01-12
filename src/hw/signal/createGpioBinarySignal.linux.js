// src/hw/signal/createGpioBinarySignal.linux.js
import GpioBinarySignalPigpio from './gpioBinarySignalPigpio.js'
import GpioBinarySignalGpiod from './gpioBinarySignalGpiod.js'

/**
 * Linux-only GPIO signal factory.
 *
 * WARNING:
 * - This module imports native GPIO libraries (pigpio, gpiod).
 * - It MUST NOT be imported on non-Linux platforms.
 *
 * This file is intentionally separated from createGpioBinarySignal.js
 * to prevent eager native imports on Windows/macOS.
 *
 * @param {object} args
 * @param {'pigpio'|'gpiod'} args.backend Selected GPIO backend
 * @param {string} [args.chip] GPIO chip (for gpiod)
 * @param {number|string} args.line GPIO line / BCM pin
 * @param {boolean} args.activeHigh Whether logical "true" corresponds to high voltage
 * @param {number} [args.glitchFilterUs] Optional pigpio glitch filter (µs)
 *
 * @returns {GpioBinarySignalPigpio|GpioBinarySignalGpiod}
 *
 * @example
 * // Linux + gpiod
 * const sig = createGpioBinarySignalLinux({
 *   backend: 'gpiod',
 *   chip: 'gpiochip0',
 *   line: 17,
 *   activeHigh: true,
 * })
 *
 * @example
 * // Linux + pigpio
 * const sig = createGpioBinarySignalLinux({
 *   backend: 'pigpio',
 *   line: 17,
 *   glitchFilterUs: 8000,
 * })
 */
export const createGpioBinarySignalLinux = function createGpioBinarySignalLinux({backend, chip, line, activeHigh, glitchFilterUs }) {
  if (backend === 'gpiod') {
    return new GpioBinarySignalGpiod({ chip, line, activeHigh })
  }

  return new GpioBinarySignalPigpio({ line, activeHigh, glitchFilterUs })
}

export default createGpioBinarySignalLinux
