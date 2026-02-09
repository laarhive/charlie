/**
 * Check whether a value is a plain object (object literal).
 *
 * A plain object is an object whose prototype is exactly `Object.prototype`.
 * This excludes arrays, buffers, dates, class instances, and other built-ins.
 *
 * @param {*} value - Value to test
 * @returns {boolean} True if the value is a plain object
 *
 * @example
 * isPlainObject({}) // true
 * isPlainObject(Buffer.from('x')) // false
 * isPlainObject([]) // false
 * isPlainObject(null) // false
 */
const isPlainObject = function (value) {
  if (value === null || typeof value !== 'object') {
    return false
  }

  return Object.getPrototypeOf(value) === Object.prototype
}

export default isPlainObject
