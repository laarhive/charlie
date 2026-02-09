<!-- docs/architecture/recording/event-template-format.md -->
# Recording Event Layout Spec (JSON5 Layout Spec)

This document defines the **layout-only formatting spec** used to pretty-print
selected `rec.events[]` entries in Charlie recordings.

The spec controls **presentation only**.  
It never changes event content, values, or structure.

---

## 1. Scope

Layout specs apply **only** to individual events in `rec.events[]`.

A layout spec is selected by:

```
event.raw.type
```

Behavior outside this scope:

- Events **without** a matching spec are rendered using  
  `JSON5.stringify(event, null, 2)`
- Non-event sections of the recording are rendered using  
  `JSON5.stringify(rec, null, 2)`

---

## 2. Spec representation

A layout spec is a **plain JavaScript object** (JSON5-compatible) that mirrors
the shape of the event object.

The spec **does not contain values or placeholders**.

Instead, it defines:
- key grouping rules for objects (`__layout`)
- array rendering rules (`__array`)

All keys present in the real event are preserved in output.

Keys not referenced by the spec are **automatically appended** at the end of
their object, one-per-line.

---

## 3. Directives

### 3.1 `__layout`

`__layout` defines which object keys should be rendered on the **same line**.

It is an array of rows, where each row is an array of keys.

```json5
{
  __layout: [
    ['id', 'i', 'tMs']
  ]
}
```

Rules:

- Applies only at the object level where it appears
- Missing keys are ignored (no mismatch)
- Keys not listed are appended afterward
- Order inside rows is respected

---

### 3.2 `__array`

`__array` controls how arrays are rendered.

Allowed values:

- `inline` – render as `[0, 18, 76]`
- `multiline` – one element per line, indented

Example (primitive array):

```json5
{
  rgb: {
    __array: 'inline'
  }
}
```

Example (array of objects):

```json5
{
  targets: {
    __array: 'multiline',
    __layout: [['id', 'xMm', 'yMm', 'speedCms', 'resolutionMm', 'valid']]
  }
}
```

Notes:

- The same spec object applies to **each array element**
- Arrays always preserve element order

---

## 4. Example

```js
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
            __layout: [['id', 'xMm', 'yMm', 'speedCms', 'resolutionMm', 'valid']]
          }
        }
      }
    }
  }
}
```

---

## 5. Error handling and fallback

- If a layout spec is malformed or structurally incompatible, the formatter:
  - logs a warning (once per path / raw.type)
  - falls back to `JSON5.stringify(event, null, 2)` for that event
- Unstringifiable values (e.g. `undefined`) are omitted at the property level,
  with a warning emitted once per path.

---

## 6. Design principles

- Explicit over implicit
- Formatting-only, never semantic
- Forward-compatible with evolving event schemas
- Safe fallback behavior
- Stable, hand-authored specs for known event types
