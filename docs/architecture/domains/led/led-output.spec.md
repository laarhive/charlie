# LED Output Architecture — Specification (v1)

This document defines how **semantic events** on the main bus drive **LED effects**
via a controller, schedulers, and raw LED devices.

**Primary goals**
- clear separation of responsibilities
- deterministic LED behavior
- config-first effect and rule definition
- easy maintenance and extension

Non-goals:
- UI
- sensor logic
- physical wiring
- effect authoring UX

---

## 1. Architectural overview

```
Main Bus (semantic events)
        ↓
LED Controller (rules + mapping)
        ↓
Per-LED Scheduler (time + priority)
        ↓
LED Domain Bus (ledRaw:command)
        ↓
LED Device (hardware I/O)
```

Key points:
- LED devices are **actuators**
- Controllers interpret **semantic intent**
- Schedulers own **time, priority, restore**
- Raw LED bus is **stateless**
- One scheduler per LED device

---

## 2. Buses

### 2.1 Main bus
Carries **semantic events**, e.g.:

- `presence:targets`
- `vibration:hit`
- `button:press`
- `system:hardware`

The main bus **never** carries LED commands.

---

### 2.2 LED domain bus

Carries **raw LED commands only**.

Event type:
```js
domainEventTypes.led.command // "ledRaw:command"
```

Payload shape:
```js
{
  ledId: 'statusLed1',     // required
  publishAs: null,         // optional
  rgb: [r, g, b]           // 0–255
}
```

Rules:
- commands are stateless
- no timing information on the bus
- `[0,0,0]` is canonical OFF
- same payload must be accepted by `inject()`

---

## 3. LED Device contract (actuator)

Responsibilities:
- subscribe to `ledRaw:command`
- perform hardware I/O
- respect `manualBlocked`
- support `inject(payload)` with inject–emit parity
- apply optional output transforms (e.g. gamma)

Constraints:
- no timing
- no effects
- no priorities
- no semantic interpretation

Gamma correction (if enabled):
- applied **in device**, before hardware write
- effects operate in logical RGB space

---

## 4. LED Controller

Responsibilities:
- subscribe to **main bus**
- evaluate rules
- resolve targets
- submit **effect requests** to schedulers

The controller:
- does **not** emit `ledRaw:command`
- does **not** manage time
- does **not** handle priority resolution

---

## 5. Effect requests (internal API)

Effect requests are **internal**, not a bus.

Shape:
```js
{
  ledId,              // required
  effectId,           // string
  params,             // resolved parameters
  priority,           // integer (higher wins)
  ttlMs,              // number | null (null = infinite)
  restore,            // boolean
  interrupt           // 'always' | 'ifLower' | 'never'
}
```

Defaults:
- `priority: 0`
- `interrupt: 'ifLower'`
- `restore: false`
- `ttlMs: null` (infinite)

---

## 6. Scheduler (per LED device)

Each LED device has **exactly one scheduler**.

Responsibilities:
- accept effect requests
- manage active effect
- resolve priority conflicts
- manage restore stack
- drive time progression
- emit `ledRaw:command`

### 6.1 Priority rules
1. Higher priority always preempts lower
2. Equal priority: last request wins
3. Lower priority ignored unless `interrupt: 'always'`

### 6.2 Restore semantics
- when preempting:
  - if `restore: true`, paused effect is pushed onto stack
- when effect ends or TTL expires:
  - pop stack and resume previous effect
- resumed effects continue with **remaining time**

### 6.3 Time model
- scheduler owns all timers
- uses frame boundaries and `setTimeout`
- effects never manage time directly

---

## 7. Effects (config-defined)

Effects are **named presets** defined in config.

Two categories:
1. `frames` — explicit RGB frames
2. built-in parametric effects

Effects are **data**, not code.

---

## 8. Built-in effect types

### 8.1 Base effects

- `solid`
- `flash`
- `breathe`
- `fadeTo`
- `frames`

---

### 8.2 Modulators

Modulators modify effect parameters using **presence data**.

Supported modulators (v1):

**Color**
- `color.fixed`
- `color.gradientByDistance`

**Speed**
- `speed.fixed`
- `speed.byDistance`

Inputs:
- `presence:targets` semantic event
- uses `payload.primary`, fallback `targets[0]`
- distance computed as `hypot(x, y)`

Order of application:
1. derive distance
2. resolve color
3. resolve speed
4. run base effect

---

## 9. Palette

Palettes are reusable color definitions.

```json5
palette: {
  colors: {
    off:  { rgb: [0, 0, 0] },
    red:  { rgb: [255, 0, 0] }
  },

  gradients: {
    distanceAlert: [
      { t: 0.0, rgb: [0, 255, 0] },
      { t: 1.0, rgb: [255, 0, 0] }
    ]
  }
}
```

Gradient `t` is always normalized `0..1`.

---

## 10. Rules (main bus → effects)

Rules map **semantic events** to **effect requests**.

### 10.1 Rule shape

```json5
{
  on: 'presence:targets',

  when: {
    coreRole: 'presence.front',
    hasPrimary: true
  },

  target: {
    ledId: 'statusLed1'
  },

  do: {
    effect: 'breathePresence',
    priority: 10,
    restore: false,
    ttlMs: null
  }
}
```

Notes:
- `target` is required (no default LED)
- `ttlMs: null` means infinite
- `when` is optional and declarative

---

### 10.2 Example: vibration hit → flash for 2s

```json5
{
  on: 'vibration:hit',
  target: { ledId: 'statusLed1' },
  do: {
    effect: 'flashRed',
    priority: 50,
    restore: true,
    ttlMs: 2000
  }
}
```

---

### 10.3 Example: presence → breathe with distance-based color + speed

```json5
{
  on: 'presence:targets',
  when: { hasPrimary: true },
  target: { ledId: 'statusLed1' },
  do: {
    effect: 'breatheByDistance',
    priority: 10,
    ttlMs: null
  }
}
```

Effect definition:

```json5
breatheByDistance: {
  type: 'breathe',
  modulators: {
    color: {
      type: 'gradientByDistance',
      gradient: 'distanceAlert',
      nearM: 0,
      farM: 3
    },
    speed: {
      type: 'byDistance',
      nearMs: 250,
      farMs: 1200,
      nearM: 0,
      farM: 3
    }
  }
}
```

---

## 11. Injection semantics

LED devices implement:
```js
inject(payload)
```

Rules:
- payload matches `ledRaw:command` shape
- allowed regardless of device state
- must not perform hardware I/O when blocked
- must not throw for expected input

Inject–emit parity is mandatory.

---

## 12. Summary

- semantic intent lives on **main bus**
- LED controller is **rule-based**
- scheduler owns **time and arbitration**
- LED devices are **pure actuators**
- effects and rules are **config-defined**
- no default LEDs
- no presentation logic in presence domain

This structure keeps LED behavior deterministic, testable, and maintainable.
