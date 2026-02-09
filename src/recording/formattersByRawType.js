// src/recording/formattersByRawType.js
/**
 * Event Layout Specs: formattersByRawType
 *
 * This module exports `formattersByRawType`, a registry of **layout-only**
 * formatting specs keyed by `event.raw.type`.
 *
 * The purpose is to provide explicit, hardcoded **presentation rules** for known
 * event types (e.g. device frames) while keeping full forward compatibility with
 * evolving event schemas.
 *
 * The spec never supplies values or placeholders and never changes content.
 * It only influences how existing event objects are rendered.
 *
 * ---
 *
 * ## Structure
 *
 * ```js
 * export const formattersByRawType = {
 *   'presenceRaw:ld2450': {
 *     __layout: [['id', 'i', 'tMs']],
 *     raw: {
 *       __layout: [['type', 'ts', 'source'], ['streamKey', 'bus']],
 *       payload: {
 *         __layout: [['deviceId', 'publishAs']],
 *         frame: {
 *           __layout: [['ts', 'offset'], ['present']],
 *           targets: {
 *             __array: 'multiline',
 *             __layout: [['id', 'xMm', 'yMm', 'speedCms', 'resolutionMm', 'valid']],
 *           },
 *         },
 *       },
 *     },
 *
 *     // Example for primitive arrays:
 *     // payload: { rgb: { __array: 'inline' } }
 *   },
 * }
 * ```
 *
 * ---
 *
 * ## Directives
 *
 * - `__layout`: array of rows; each row is an array of keys to render on the same line.
 * - `__array`: controls array rendering at that key:
 *   - `'inline'` → `[0, 18, 76]`
 *   - `'multiline'` → one element per line
 *
 * For arrays of objects, the same spec object may include `__layout`, which is applied
 * to each array element.
 *
 * ---
 *
 * ## Contract
 *
 * - Specs apply only to `rec.events[]` entries and are selected by `event.raw.type`.
 * - All keys present in the real event are preserved in output.
 * - Keys not referenced by the spec are automatically **appended** at the end of their
 *   containing object (one-per-line).
 * - Missing keys referenced by the spec are ignored (no mismatch).
 * - If no spec exists for a given `raw.type`, formatting falls back to
 *   `JSON5.stringify(event, null, 2)` for those events.
 *
 * Specs should be added only for event types with known, intentional structure, and kept
 * stable over time.
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
