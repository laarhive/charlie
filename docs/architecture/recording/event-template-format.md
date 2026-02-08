# Recording Event Template Format (JSON5 Template)

This document defines the small template format used to pretty-print selected
`rec.events[]` entries in Charlie recordings.

It is intentionally minimal, explicit, and non-inferential.

## 1. Scope

Templates apply only to individual events in `rec.events[]`.
A template is selected by `event.raw.type`.

Anything not covered by a template is rendered via:

- `JSON5.stringify(event, null, 2)` for events
- `JSON5.stringify(rec, null, 2)` for non-event sections

## 2. Template representation

A template is a JSON5 object literal encoded as a string.

Example:

```json5
{
  id: '#', i: '#', tMs: '#',
  raw: {
    type: '#', ts: '#', source: '#',
    streamKey: '#',
    payload: {
      deviceId: '#', publishAs: '#',
      frame: {
        ts: '#', offset: '#',
        targets: [
          { id: '#', xMm: '#', yMm: '#', speedCms: '#', resolutionMm: '#', valid: '#' },
        ],
      },
    },
  },
}
