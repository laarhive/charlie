//src/recording/formattersByRawType.js
/**
 * Event Templates: formattersByRawType
 *
 * This module exports `formattersByRawType`, a registry of event formatting
 * templates keyed by `event.raw.type`.
 *
 * The goal is to provide explicit, hardcoded layouts for known event types
 * (e.g. device frames) while preserving the ability to fall back safely for
 * unknown or evolving structures.
 *
 * ---
 *
 * ## Structure
 *
 * ```js
 * export const formattersByRawType = {
 *   'presenceRaw:ld2450': `{
 *     id: '#', i: '#', tMs: '#',
 *     raw: {
 *       type: '#', ts: '#', source: '#',
 *       streamKey: '#',
 *       payload: {
 *         deviceId: '#', publishAs: '#',
 *         frame: {
 *           ts: '#', offset: '#',
 *           targets: [
 *             { id: '#', xMm: '#', yMm: '#', speedCms: '#', resolutionMm: '#', valid: '#' },
 *           ],
 *         },
 *       },
 *     },
 *   }`,
 * }
 * ```
 *
 * ---
 *
 * ## Contract
 *
 * - Keys and nesting in the template define output ordering and layout.
 * - `'#'` placeholders pull values from the event being formatted.
 * - Arrays written as `[ { ... } ]` represent a repeat-template for all elements.
 * - Extra keys in real events are allowed and ignored by templated output.
 * - If an event does not match its template, the formatter will log a warning and
 *   fall back to `JSON5.stringify(event, null, 2)` for that event.
 *
 * Templates should be written to be stable over time and should only be added
 * when the event structure is known and intentional.
 */
export const formattersByRawType = {
  'presenceRaw:ld2450': {
    __layout: [['id', 'i', 'tMs']],
    raw: {
      __layout: [['type', 'ts', 'source'], ['streamKey', 'bus']],
      payload: {
        __layout: [['deviceId', 'publishAs']],
        frame: {
          __layout: [['ts', 'offset'], ['present']],
          targets: {
            __array: 'multiline',
            __layout: [['id', 'xMm', 'yMm', 'speedCms', 'resolutionMm', 'valid']],
          },
        },
      },
    },
  },

  'ledRaw:command': {
    __layout: [['id', 'i', 'tMs']],
    raw: {
      __layout: [['type', 'ts', 'source'], ['streamKey', 'bus']],
      payload: {
        __layout: [['ledId', 'publishAs', 'rgb']],
        rgb: {
          __array: 'inline',
        },
      },
    },
  },
}

export const formatter = {
  'presenceRaw:ld2450': {
    __layout: [['id', 'i', 'tMs']],
    raw: {
      __layout: [['type', 'ts', 'source'], ['streamKey', 'bus']],
      payload: {
        __layout: [['deviceId', 'publishAs']],
        frame: {
          __layout: [['ts', 'offset'], ['present']],
          targets: {
            __array: 'multiline',
            __layout: [['id', 'xMm', 'yMm', 'speedCms', 'resolutionMm', 'valid']],
          },
        },
      },
    },
  },
}
