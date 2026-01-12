// src/hw/signal/createGpioBinarySignal.js
import process from 'node:process'
import { createRequire } from 'node:module'
import VirtualBinarySignal from './virtualBinarySignal.js'

const require = createRequire(import.meta.url)

export default createGpioBinarySignal

/**
 * Platform-safe factory for GPIO-backed binary signals.
 *
 * IMPORTANT:
 * - This file MUST remain safe to import on all platforms (Windows, macOS, Linux).
 * - It MUST NOT import any native GPIO modules (pigpio, gpiod) at top-level.
 *
 * Rationale:
 * Node ESM imports are eager. Importing native GPIO modules on Windows
 * causes immediate crashes, even if code paths are never executed.
 *
 * Strategy:
 * - On non-Linux platforms, always return a VirtualBinarySignal.
 * - On Linux, delegate to a Linux-only factory module that may import native GPIO libs.
 *
 * This file acts as a strict platform boundary.
 *
 * @param {object} args
 * @param {'pigpio'|'gpiod'} args.backend Selected GPIO backend (Linux only)
 * @param {string} [args.chip] GPIO chip (for gpiod)
 * @param {number|string} args.line GPIO line / BCM pin
 * @param {boolean} args.activeHigh Whether logical "true" corresponds to high voltage
 * @param {number} [args.glitchFilterUs] Optional pigpio glitch filter (µs)
 *
 * @returns {VirtualBinarySignal|object} A binary signal implementation
 *
 * @example
 * // Windows / macOS
 * const sig = createGpioBinarySignal({ backend: 'pigpio', line: 17 })
 * // -> returns VirtualBinarySignal, no native imports
 *
 * @example
 * // Linux
 * const sig = createGpioBinarySignal({
 *   backend: 'pigpio',
 *   line: 17,
 *   activeHigh: true,
 *   glitchFilterUs: 8000
 * })
 */
export const createGpioBinarySignal = function createGpioBinarySignal({ backend, chip, line, activeHigh, glitchFilterUs }) {
  if (process.platform !== 'linux') {
    return new VirtualBinarySignal(false)
  }

  // Linux-only path: safe to load native GPIO implementations
  const createLinux = require('./createGpioBinarySignal.linux.js').default
  return createLinux({ backend, chip, line, activeHigh, glitchFilterUs })
}
