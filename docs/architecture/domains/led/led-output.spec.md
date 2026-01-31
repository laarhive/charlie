# LED Output Architecture — Specification & HLD

This document defines the **LED output architecture** for Charlie Core,
incorporating effect factories, scheduling, and priority-based arbitration.

It builds on the existing **Device Contract** and **inject/emit parity** rules
and applies semantic control via buses with device-level execution.

---

## 1. Scope and intent

This specification defines:

- how LED behavior is derived from system events
- how LED effects are composed, scheduled, and prioritized
- how LED devices interact with buses, controllers, and inject
- how blocking and injection semantics apply to actuators

Non-goals:
- UI rendering
- physical LED wiring
- effect authoring UX

---

## 2. Architectural position

LED handling follows the same architectural pattern as other domains:

```
Semantic events (main bus)
        ↓
LED Controller (decision logic)
        ↓
LED Scheduler (per-device arbitration)
        ↓
LED Domain Bus (raw-ish LED commands)
        ↓
LED Device(s) (hardware IO or virtual)
```

Key properties:
- LED devices are **actuators**
- LED devices **subscribe** to their domain bus
- LED devices **do not interpret semantic intent**
- LED devices execute **raw-ish LED commands only**

---

## 3. Buses

### 3.1 Main bus
Carries **semantic events** such as:
- presence enter/exit
- button press
- system hardware degraded/ok

The main bus **never** carries LED commands.

---

### 3.2 LED domain bus

The LED domain bus carries **raw-ish LED output commands**.

Examples:
- set RGB
- turn off

This bus:
- is observable (tap-able via WebSocket)
- is the only input channel for LED devices (besides inject)

---

## 4. LED Device model

### 4.1 Responsibilities

An LED device:
- subscribes to the LED domain bus on `start()`
- executes raw LED commands (`rgb`, `off`, etc.)
- performs hardware IO only when **not manualBlocked**
- accepts `inject(payload)` for simulation/testing
- does not implement effects, timing, or priorities

### 4.2 Blocking behavior

When `manualBlocked`:
- bus events **must not** cause hardware IO
- device **may** update internal simulated state
- `inject(payload)` remains allowed

Bus subscription may remain active; suppression is logical, not structural.

---

## 5. LED Controller

### 5.1 Role

The LED Controller:
- subscribes to the **main bus**
- interprets semantic events
- decides *what visual behavior should occur*
- never talks to hardware directly

The controller does **not** emit LED frames itself.

---

### 5.2 Output

For each relevant semantic event, the controller submits an **effect request**
to a scheduler.

The controller does **not** manage timing loops, fades, or priority resolution.

---

## 6. Effect model

### 6.1 EffectFactory (pure)

Effects are defined externally via an **EffectFactory**.

Properties:
- pure functions
- no timers
- no hardware IO
- deterministic output

Signature:
```js
createEffect(effectId, params) -> EffectPlan
```

---

### 6.2 EffectPlan

An EffectPlan represents **how LED output evolves over time**.

Constraints:
- deterministic
- side-effect free
- time-relative

Possible representations:
- generator yielding `{ dtMs, rgb }`
- iterator over frames
- abstract schedule object

The scheduler, not the effect, owns time.

---

## 7. LED Scheduler (core of the system)

### 7.1 Instantiation model

**One LED Scheduler per LED device**.

Rationale:
- simplifies state management
- avoids cross-device interference
- matches physical reality

---

### 7.2 Responsibilities

The scheduler:
- owns the active effect for a given LED
- resolves priority conflicts
- manages preemption and restoration
- emits raw LED commands on the LED bus
- drives time progression (tick loop)

The scheduler is the **only component allowed to manage time** for LED output.

---

### 7.3 Effect request shape

```js
{
  ledId,
  effectId,
  params,

  priority,        // integer, higher wins
  ttlMs,           // optional
  interrupt,       // 'always' | 'ifLower' | 'never'
  restore          // boolean
}
```

Defaults:
- `priority`: 0
- `interrupt`: 'ifLower'
- `restore`: false

---

### 7.4 Priority & arbitration rules

1. Higher priority **always preempts** lower priority
2. Equal priority:
  - last request wins
3. Lower priority:
  - ignored if an active effect exists

---

### 7.5 Restore semantics (stack model)

Each scheduler maintains an **effect stack**.

- When a new effect preempts another:
  - if `restore === true`, push the old effect onto the stack
- When an effect expires (TTL):
  - pop the stack and resume the previous effect

Example:
- presence breathing (priority 10, infinite)
- button flash (priority 50, ttl 1000ms, restore true)
  → after 1s, breathing resumes automatically

---

### 7.6 TTL handling

- TTL is counted from effect activation
- when TTL expires:
  - effect stops
  - restore behavior applies
- no implicit fade-out unless effect defines it

---

## 8. LED Domain Bus events

### 8.1 Command shape

Example:
```js
{
  type: 'led:rgb',
  ts,
  source,
  payload: {
    ledId,
    r,
    g,
    b
  }
}
```

Other commands:
- `led:off`

Rules:
- commands are **stateless**
- no timing encoded in the bus
- scheduler is responsible for emission cadence

---

## 9. Injection semantics (actuators)

LED devices follow the **same inject contract as sensors**.

### 9.1 `inject(payload)`

- payload matches LED domain payload shape
- works regardless of device state
- must not perform hardware IO when blocked
- must not throw for expected cases

Injection parity:
- anything the device can emit or consume via bus
  must be valid input to `inject()`

---

## 10. Observability

- LED bus is tap-able over WebSocket
- Schedulers are internal and not directly observable
- Device runtime state changes are published via `system:hardware`

This allows:
- debugging LED behavior
- replaying LED command streams
- validating effect arbitration

---

## 11. Summary

- Semantic intent lives on the **main bus**
- LED logic lives in **LED Controller**
- Time + priority live in **LED Scheduler**
- Hardware IO lives in **LED Device**
- One scheduler per LED device
- Priority + stack-based restore handle conflicts cleanly
- Inject remains consistent with sensor devices

This keeps:
- devices dumb
- controllers declarative
- scheduling deterministic
- testing straightforward
