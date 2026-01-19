<!-- docs/architecture/devices/button-edge.device.md -->
# ButtonEdgeDevice — Specification

## Overview

**ButtonEdgeDevice** represents a binary button input and converts **raw binary transitions** into **domain-level button edge events**.

It is intentionally **dumb and minimal**:
- no debouncing
- no press/hold semantics
- no timing logic
- no command parsing

All higher-level behavior (debounce, short/long press, cooldowns, mapping to actions) is handled **outside the device**, typically by a controller.

This document serves as:
- the **formal specification** for `ButtonEdgeDevice`
- a **template** for implementing future devices

---

## Responsibilities

### What the device does
- Subscribe to a **binary input protocol**
- Detect **state transitions**
- Emit **domain edge events** (`rising` / `falling`)
- Report **hardware health** via `system:hardware`
- Accept **injected input** for simulation/testing

### What the device does *not* do
- No debounce
- No filtering
- No interpretation of button semantics
- No command parsing
- No lifecycle orchestration beyond its own protocol

---

## Domain

- **Domain**: `button`
- **Domain event type**: `buttonRaw:edge`

---

## Runtime states

Reported via `system:hardware` events:

| State | Meaning |
|-----|--------|
| `active` | Protocol input is attached and functioning |
| `degraded` | Protocol error detected |
| `manualBlocked` | Device explicitly blocked |

---

## Protocol input (real / virtual)

### Required protocol contract

The protocol must provide a **binary input** with:

```js
subscribe(handler: (value: boolean) => void) -> unsubscribe()
```

Optional:
```js
dispose()
```

---

## Supported protocols

### 1. Virtual protocol (`type: 'virt'`)

Used for development, tests, and simulation.

#### Configuration example

```js
{
  kind: 'buttonEdge',
  domain: 'button',
  protocol: {
    type: 'virt',
    initial: false
  }
}
```

#### Behavior
- Initial value is `false`
- Calling `set(true | false)` triggers a value change
- Repeated identical values do **not** emit events

---

### 2. GPIO protocol (`type: 'gpio'`)

Used on real hardware.

#### Configuration example

```js
{
  kind: 'buttonEdge',
  domain: 'button',
  protocol: {
    type: 'gpio',
    chip: 'gpiochip0',
    line: 21,
    activeHigh: false
  }
}
```

#### Expected behavior
- GPIO line is configured as input
- Hardware interrupts produce boolean values
- Each interrupt is treated as a raw level change

---

## Output: Domain events

### Event type

```js
domainEventTypes.button.edge
// string value: 'buttonRaw:edge'
```

### Payload format

```js
{
  deviceId: string,
  publishAs: string,
  edge: 'rising' | 'falling'
}
```

### Emission rules

| Condition | Result |
|--------|--------|
| `false → true` | emit `{ edge: 'rising' }` |
| `true → false` | emit `{ edge: 'falling' }` |
| stable `true → true` | no event |
| stable `false → false` | no event |
| first observed value | no event |

---

## Injection

### Purpose
Injection is the **only supported simulation/control channel** that works regardless of device state.

It is used by:
- tests
- simulators
- CLI tooling
- replay systems

---

### Injection contract

```js
inject(payload) -> { ok: true } | { ok: false, error: string }
```

### Accepted payload format

```js
{ edge: 'rising' }
{ edge: 'falling' }
```

### Invalid payloads

Examples that must fail:

```js
undefined
{}
{ edge: 'press' }
{ foo: 'bar' }
```

Recommended response:

```js
{ ok: false, error: 'INVALID_INJECT_PAYLOAD' }
```

---

### Injection behavior

- Injection **does not interact with hardware**
- Injection **does not start or attach protocols**
- Injection **always works regardless of device state**:
  - `active`
  - `manualBlocked`
  - `degraded`
- Injection **may emit domain events even when blocked**

---

## Blocking behavior

### Real protocol input

When the device is `manualBlocked`:
- protocol input is **suppressed**
- interrupts are ignored
- no domain events are emitted from real input

### Injection input

When the device is `manualBlocked`:
- injection **still works**
- domain events **may be emitted**

---

## system:hardware events

The device publishes hardware state changes to the **main bus**.

### Event type

```js
eventTypes.system.hardware
```

### Payload format

```js
{
  deviceId: string,
  publishAs: string,
  state: 'active' | 'degraded' | 'manualBlocked',
  detail?: {
    error?: string
  }
}
```

---

## Design principles (important)

- Device is **edge-only**
- Device is **stateless beyond last level**
- Device is **fully deterministic**
- Device has **no timing logic**
- Device has **no semantic interpretation**
- Device is **safe to inject at any time**

---

---

## Example usage

This section demonstrates **typical usage patterns** for `ButtonEdgeDevice` with:
- virtual protocol (development / tests)
- GPIO protocol (real hardware)
- injection (simulation / control)

These examples are **illustrative**, not prescriptive.

---

### Example 1: Virtual protocol (development / tests)

#### Device configuration

```js
{
  id: 'buttonVirt1',
  publishAs: 'button1',
  domain: 'button',
  kind: 'buttonEdge',
  protocol: {
    type: 'virt',
    initial: false
  },
  modes: ['win11'],
  state: 'active'
}
```

#### Simulating input via virtual protocol

```js
// assuming access to the virtual input instance
input.set(false) // no event
input.set(true)  // emits { edge: 'rising' }
input.set(true)  // no event
input.set(false) // emits { edge: 'falling' }
```

#### Resulting domain events

```js
{
  type: 'buttonRaw:edge',
  payload: {
    deviceId: 'buttonVirt1',
    publishAs: 'button1',
    edge: 'rising'
  }
}

{
  type: 'buttonRaw:edge',
  payload: {
    deviceId: 'buttonVirt1',
    publishAs: 'button1',
    edge: 'falling'
  }
}
```

---

### Example 2: GPIO protocol (real hardware)

#### Device configuration

```js
{
  id: 'buttonGpio1',
  publishAs: 'button1',
  domain: 'button',
  kind: 'buttonEdge',
  protocol: {
    type: 'gpio',
    chip: 'gpiochip0',
    line: 21,
    activeHigh: false
  },
  modes: ['rpi4'],
  state: 'active'
}
```

#### Hardware behavior

- GPIO line is configured as input
- Hardware interrupts produce boolean values
- Each **level transition** produces a domain edge event

Example physical interaction:

| Physical action | GPIO level | Domain event |
|-----------------|-----------|--------------|
| Button press    | LOW → HIGH | `edge: 'rising'` |
| Button release  | HIGH → LOW | `edge: 'falling'` |

No debounce or filtering occurs at the device level.

---

### Example 3: Injection (simulation / control)

Injection is the **preferred mechanism** for:
- tests
- simulators
- CLI control
- replays

#### Injecting via DeviceManager

```js
deviceManager.inject('buttonGpio1', { edge: 'rising' })
```

#### Result

```js
{
  ok: true
}
```

A domain event is emitted:

```js
{
  type: 'buttonRaw:edge',
  payload: {
    deviceId: 'buttonGpio1',
    publishAs: 'button1',
    edge: 'rising'
  }
}
```

#### Injecting while manualBlocked

```js
deviceManager.block('buttonGpio1')
deviceManager.inject('buttonGpio1', { edge: 'falling' })
```

- Injection succeeds
- Domain event may be emitted
- No hardware IO occurs

---

### Example 4: Invalid injection payloads

```js
deviceManager.inject('buttonGpio1', undefined)
deviceManager.inject('buttonGpio1', {})
deviceManager.inject('buttonGpio1', { edge: 'press' })
```

Expected result:

```js
{
  ok: false,
  error: 'INVALID_INJECT_PAYLOAD'
}
```

No exceptions are thrown.

---

### Example 5: Controller-level semantics (illustrative)

Higher-level logic (not part of the device):

```js
if (event.edge === 'rising') {
  startPressTimer()
}

if (event.edge === 'falling') {
  stopPressTimer()
  classifyPressDuration()
}
```

This logic **must not** live in the device.

---

## Summary

ButtonEdgeDevice is a **raw signal adapter**.

It converts:
```
binary input  →  edge events
```

Nothing more.

This strict minimalism makes it:
- easy to reason about
- easy to test
- easy to extend
- a clean foundation for higher-level controllers

This document should be used as the **baseline template** when designing new devices.
