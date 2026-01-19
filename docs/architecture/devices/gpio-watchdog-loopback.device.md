<!-- src/architecture/devices/gpio-watchdog-loopback.device.md -->
# GpioWatchdogLoopbackDevice — Specification

This document specifies **GpioWatchdogLoopbackDevice**.

It intentionally diverges from some expectations of interactive devices
(e.g. button, sensor devices) and those deviations are explicitly documented.

This device must otherwise comply with `device.contract.md`.

---

## Overview

**GpioWatchdogLoopbackDevice** monitors the health of the GPIO subsystem by
continuously verifying an **output → input loopback**.

It is a **pure health-monitoring device**:
- it does not emit domain events
- it does not accept meaningful injection
- it exists solely to detect hardware failure modes

---

## Responsibilities

### What the device does
- Toggles a GPIO output line periodically
- Listens for edges on a paired GPIO input line
- Detects missing edges (stale condition)
- Classifies and reports GPIO-related errors
- Publishes hardware health via `system:hardware`

### What the device does *not* do
- Does not emit domain events
- Does not simulate hardware behavior
- Does not provide actuator-style injection

---

## Domain output

**None.**

This device does not publish any domain-level events.

This is an intentional deviation.

---

## Supported protocol

### GPIO loopback protocol

#### Configuration example

```js
{
  id: 'gpioWatchdog1',
  kind: 'gpioWatchdogLoopback',
  domain: 'main',
  protocol: {
    chip: 'gpiochip0',
    outLine: 17,
    inLine: 27,
    consumerTag: 'charlie',
    reclaimOnBusy: true
  },
  params: {
    toggleMs: 1000,
    bias: 'pull-down'
  },
  modes: ['rpi4'],
  state: 'active'
}
```

#### Expected behavior
- `outLine` is configured as GPIO output
- `inLine` is configured as GPIO input
- Output toggles every `toggleMs`
- Each input edge resets the stale timer

---

## Runtime behavior

### States

| State | Meaning |
|------|--------|
| `active` | Loopback edges are observed |
| `degraded` | No edges or GPIO error detected |
| `manualBlocked` | Device explicitly blocked |

---

## Injection

### Supported behavior

This device **implements `inject(payload)` only to satisfy the device contract**.

#### Behavior
- Injection does nothing
- Injection always returns `{ ok: true }`
- Injection must never throw
- Injection must never perform hardware IO

This is an **intentional no-op injection**.

### Rationale

The watchdog:
- has no meaningful simulated input
- cannot be externally “driven” safely
- is not an actuator

However, injection must still be callable so:
- tests do not need to special-case it
- DeviceManager behavior remains uniform

---

## Blocking behavior

### Real protocol input

When `manualBlocked`:
- GPIO lines must be released
- Timers must be cleared
- No toggling must occur

### Injection input

When `manualBlocked`:
- Injection is still accepted
- Injection performs no action

---

## system:hardware events

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
  detail: {
    error?: string,
    errorCode?: string,
    loopback: {
      outLine: number,
      inLine: number,
      toggleMs: number,
      staleMs: number,
      consumerTag: string,
      reclaimOnBusy: boolean
    }
  }
}
```

---

## Error classification

GPIO errors are classified into stable error codes:

| Error code | Meaning |
|-----------|--------|
| `busy` | GPIO line already in use |
| `permission` | Permission denied |
| `not_found` | GPIO device not present |
| `invalid_args` | Invalid GPIO arguments |
| `line_requested` | Line already requested |
| `unknown` | Unclassified error |

---

## Design principles

- Health-monitoring only
- No domain output
- No simulation semantics
- Deterministic error reporting
- Fail-safe behavior

---

## Example lifecycle

```text
start()
  ↓
toggle output
  ↓
input edge observed
  ↓
active
```

```text
no input edge
  ↓
stale timeout
  ↓
degraded
```

---

## Summary

GpioWatchdogLoopbackDevice is a **non-interactive health monitor**.

It exists to answer one question:

> “Is the GPIO subsystem still functioning?”

It intentionally does not behave like a sensor or actuator and should not
be treated as one.
