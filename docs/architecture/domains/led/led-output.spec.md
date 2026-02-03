# LED Output Architecture — Specification (v1)

This document defines how semantic events on the main bus drive LED effects via a controller,
schedulers, and raw LED devices.

Primary goals
- clear separation of responsibilities
- deterministic LED behavior
- config-first effect/rule definition
- config validation fails hard at startup

Non-goals
- UI
- sensor logic
- physical wiring
- effect authoring UX

---

## 1. Architecture

```
Main Bus (semantic)
        ↓
LED Controller (rules)
        ↓
Per-LED Scheduler (time + priority)
        ↓
LED Domain Bus (ledRaw:command)
        ↓
LED Device (hardware I/O)
```

---

## 2. Buses

### 2.1 Main bus
Semantic event examples
- `presence:targets`
- `presence:exit`
- `vibration:hit`
- `button:press`

### 2.2 LED domain bus
Raw command event type:
- `domainEventTypes.led.command` (`"ledRaw:command"`)

Payload:
```js
{
  ledId: 'statusLed1',
  publishAs: null,
  rgb: [r, g, b]
}
```

---

## 3. LED device contract
- subscribes to `ledRaw:command`
- executes hardware I/O (unless blocked)
- supports `inject(payload)` with inject–emit parity
- optional gamma correction is applied in the device

---

## 4. LED controller
- subscribes to main bus
- evaluates config rules
- resolves explicit targets (no default LED)
- submits effect requests to schedulers
- does not emit raw LED commands
- does not manage timing

---

## 5. Scheduler
One scheduler per LED device.
- owns timers (`setTimeout`)
- owns priority + restore stack
- emits `ledRaw:command`

Continuous semantic updates (presence):
- if active effectId + priority match, scheduler updates `sourceEvent` without restarting the effect runner

---

## 6. Config model

### 6.1 Palette
```json5
palette: {
  colors: {
    off:  { rgb: [0, 0, 0] },
    red:  { rgb: [255, 0, 0] }
  },
  gradients: {
    presenceDistance: [
      { t: 0.0, rgb: [0, 80, 255] },
      { t: 1.0, rgb: [255, 0, 0] }
    ]
  }
}
```

### 6.2 RGB field
Wherever a color is required, the field name is `rgb` and supports:
- `rgb: 'red'` (palette color name)
- `rgb: [255, 0, 0]` (literal triplet)

---

## 7. Effect types (v1)

### 7.1 frames
Static RGB frames with holds.

```json5
flashRed: {
  type: 'frames',
  loop: 'inf', // optional: true|'inf'|N
  frames: [
    { rgb: 'red', holdMs: 120 },
    { rgb: 'off', holdMs: 120 }
  ]
}
```

### 7.2 fadeTo
Interpolates from current RGB to a target RGB.

```json5
fadeToBlue: {
  type: 'fadeTo',
  rgb: 'blue',
  ms: 400,
  ease: 'linear'
}
```

### 7.3 breathe
Oscillating intensity mix (`0→1→0`) over a period.

```json5
breathePresence: {
  type: 'breathe',
  rgb: 'blue',     // fallback when no targets
  periodMs: 2400,  // fallback when no speed modulator
  minMix: 0.08,
  maxMix: 0.35,
  ease: 'inOutSine',

  modulators: {
    color: {
      type: 'gradientByDistance',
      gradient: 'presenceDistance',
      nearM: 0.0,
      farM: 3.0
    },
    speed: {
      type: 'byDistance',
      nearM: 0.0,
      farM: 3.0,
      nearMs: 900,
      farMs: 2800
    }
  }
}
```

### 7.4 sequence
Deterministic step timeline for composed patterns (heartbeat, multi-pulse alerts).

Supported step ops:
- `hold` `{ op:'hold', ms }`
- `fadeTo` `{ op:'fadeTo', rgb, ms, ease }`

```json5
heartbeatRed: {
  type: 'sequence',
  loop: 'inf',
  steps: [
    { op: 'fadeTo', rgb: [200, 10, 10], ms: 90,  ease: 'linear' },
    { op: 'hold',   ms: 40 },
    { op: 'fadeTo', rgb: [20, 1, 1],    ms: 140, ease: 'linear' },

    { op: 'hold', ms: 120 },

    { op: 'fadeTo', rgb: [255, 14, 14], ms: 110, ease: 'linear' },
    { op: 'hold',   ms: 60 },
    { op: 'fadeTo', rgb: 'off',         ms: 220, ease: 'linear' },

    { op: 'hold', ms: 850 }
  ]
}
```

---

## 8. Rules

Rule shape:
```json5
{
  on: 'vibration:hit',
  target: { alias: 'status' },
  do: {
    effect: 'flashRed',
    priority: 50,
    restore: true,
    ttlMs: 2000
  }
}
```

---

## 9. Validation (fail hard)

Config validation must throw on invalid config.

Minimum checks
- palette colors and gradients are valid
- every rule has `on`, `target`, and `do.effect`
- referenced `effect` exists
- effect type is known and has required fields
- `rgb` values are either palette color names or `[r,g,b]`
- `sequence.steps[*].op` is known and fields are valid
- `loop` is `true|'inf'|N`

