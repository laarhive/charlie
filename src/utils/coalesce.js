// src/utils/coalesce.js

/**
 * Returns the first value that is not null or undefined.
 * Evaluation is left-to-right and preserves falsy values
 * such as 0, false, and empty strings.
 *
 * @template T
 * @param {...T} values Values to evaluate
 * @returns {T|undefined} First non-nullish value, or undefined if none found
 *
 * @example
 * coalesce(undefined, null, 0, 'x') // 0
 * coalesce(null, undefined, 'a', 'b') // 'a'
 * coalesce(undefined, undefined) // undefined
 */
export const coalesce = function coalesce(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined) return v
  }
  return undefined
}

/**
 * Returns the first value that is not null, undefined, or an empty string.
 * String values are trimmed before emptiness is checked.
 *
 * Useful when empty strings should be treated as "not provided".
 *
 * @template T
 * @param {...T} values Values to evaluate
 * @returns {T|undefined} First non-empty value, or undefined if none found
 *
 * @example
 * coalesceNonEmpty(undefined, '', 'a') // 'a'
 * coalesceNonEmpty('   ', 'x') // 'x'
 * coalesceNonEmpty(null, undefined) // undefined
 */
export const coalesceNonEmpty = function coalesceNonEmpty(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return undefined
}
