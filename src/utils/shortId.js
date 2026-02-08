// src/utils/shortId.js
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

let lastTime = -1
let counter = 0

/**
 * Generates a short base62 identifier.
 *
 * Capacity and guarantees (single process):
 * - Total value space: 62^chars
 * - Time window: 60,000 ms (wraps every minute)
 * - Per-millisecond capacity: floor((62^chars) / 60,000)
 * - Guaranteed unique for up to that many calls within the same millisecond
 * - IDs may repeat across different minutes or process restarts
 *
 * Practical notes:
 * - chars = 3 → 62^3 = 238,328 values → 3 IDs/ms
 * - chars = 4 → 62^4 = 14,776,336 values → 246 IDs/ms
 * - chars < 3 severely limits per-ms capacity
 *
 * @param {number} chars - Number of base62 characters (minimum 2).
 * @returns {string} A base62 string of exactly `chars` characters.
 * @example
 * // returns a 3-character base62 id, e.g. '4kl'
 * shortId(3)
 */
export const shortId = function shortId(chars = 4) {
  if (!Number.isInteger(chars) || chars < 2) {
    throw new Error('chars must be an integer >= 2')
  }

  const maxValues = 62 ** chars
  const slotsPerMs = Math.max(1, Math.floor(maxValues / 60000))

  const now = new Date()
  const time = now.getSeconds() * 1000 + now.getMilliseconds() // 0..59999

  if (time === lastTime) {
    counter = (counter + 1) % slotsPerMs
  } else {
    lastTime = time
    counter = 0
  }

  const value = time * slotsPerMs + counter
  return toBase62(value, chars)
}

/* Converts a number to a fixed-length base62 string. */
const toBase62 = function toBase62(num, width) {
  let out = ''

  while (num > 0) {
    out = BASE62[num % 62] + out
    num = Math.floor(num / 62)
  }

  return out.padStart(width, '0')
}
