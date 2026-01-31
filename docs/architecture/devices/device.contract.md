<-- src/architecture/devices/device.contract.md -->
This document defines the **mandatory contract** that all devices must follow.

It is the source of truth for:
- lifecycle behavior
- blocking semantics
- injection semantics
- error/result shapes
- external input suppression rules

Device-specific specifications (e.g., `button-edge.device.md`) must comply with this contract.

---

## 1. Device lifecycle

Devices are created and owned by **DeviceManager** (or a dedicated owner in tests).

### 1.1 Start / stop

Devices implement a lifecycle with:
- `start()` to attach protocol inputs and begin operating
- `dispose()` to detach all inputs, release resources, and become inert

### 1.2 Idempotency

Devices must be safe to call repeatedly:
- `start()` is idempotent
- `dispose()` is idempotent
- `block()` is idempotent
- `unblock()` is idempotent

Devices must not throw for expected cases.

---

## 2. Blocking and suppression rules

### 2.1 `manualBlocked` meaning

When a device is `manualBlocked`, it must:
- suppress external protocol input
- avoid any hardware IO initiated from external inputs
- remain injectable (injection is still accepted)

Blocking is an explicit operator/config decision and must not be treated as a runtime fault.

### 2.2 External protocol input suppression

When `manualBlocked`:
- external protocol input must be suppressed
- interrupts, callbacks, or protocol listeners must not emit domain events
- protocol subscriptions may be detached or ignored

### 2.3 Injection remains allowed

When `manualBlocked`:
- `inject(payload)` remains allowed
- `inject(payload)` must not perform hardware IO

Injection may still:
- emit domain events (device-specific)
- update internal simulated state (device-specific)

---

## 3. Device injection contract

### 3.1 `Device.inject(payload)`

All devices must implement:

```js
inject(payload) -> { ok: true } | { ok: false, error: string }
```

#### Rules

- `payload` is device-native:
  - object, number, string, boolean, or null
  - `undefined` is considered malformed
  - not a command string
- devices do not parse commands
- devices must not throw for expected cases

#### State independence

`inject(payload)`:
- works regardless of device runtime state:
  - `active`
  - `manualBlocked`
  - `degraded`
- must not perform hardware IO when `manualBlocked`
  - must not start protocol subprocesses
  - must not open GPIO lines or device files
  - must not write to hardware outputs
  - must not attach real interrupt listeners
- may update internal simulated state when `manualBlocked`
- may emit domain events when `manualBlocked` (device-specific)

#### Error handling

- malformed payloads:
  - optional validation
  - recommended error: `{ ok: false, error: 'INVALID_INJECT_PAYLOAD' }`
- all other expected cases:
  - `{ ok: true }`

Errors:
- must use stable error codes
- must not throw for expected failure modes

---

### 3.2 Inject / emit parity (record & replay compatibility)

For any device that **emits events on a domain bus**:

> Every payload shape emitted by the device **must be accepted by**
> `inject(payload)`.

This guarantees:
- recorded domain events can be replayed verbatim
- Recorder and Player remain device-agnostic
- no translation logic exists outside devices

Rules:
- emitted payload shapes define the inject surface
- `inject(payload)` must tolerate those shapes
- malformed payloads may return `{ ok:false, error:'INVALID_INJECT_PAYLOAD' }`
- inject must not throw for expected cases

This rule does **not** require devices to re-emit injected payloads,
only to accept them and behave sensibly.

---

## 4. Runtime state reporting

Devices report operational state via `system:hardware` events on the main bus.

### Required states

- `active`
- `degraded`
- `manualBlocked`

### Payload requirements

At minimum, hardware events must include:
- `deviceId`
- `publishAs`
- `state`

Devices may include a `detail` object, typically containing:
- `error` (string)
- other device-specific diagnostic fields

---

## 5. Input channel model

Devices conceptually accept input from two channels:

| Input source | Allowed when blocked | Notes |
|-------------|---------------------|------|
| Real hardware | no | suppressed |
| Virtual protocol input | no | suppressed |
| `inject(payload)` | yes | always allowed |

Injection is the **only supported simulation/control channel** guaranteed to remain active while blocked.
