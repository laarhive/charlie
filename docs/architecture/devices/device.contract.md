# Device Contract

This document defines the mandatory contract that all devices must follow.

It is the source of truth for:
- lifecycle behavior
- blocking semantics
- injection semantics
- error/result shapes
- external input suppression rules
- bus input/output behavior

Device-specific specifications must comply with this contract.

---

## 1. Device lifecycle

Devices are created and owned by DeviceManager (or a dedicated owner in tests).

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
- suppress all external inputs (protocol input and bus input)
- avoid any hardware IO initiated from external inputs
- remain injectable (injection is still accepted)

Blocking is an explicit operator/config decision and must not be treated as a runtime fault.

---

## 3. External input model

Devices conceptually accept input from two external sources:

1) protocol input (hardware or virtual protocol listeners)
2) bus input (domain bus subscriptions for actuator devices)

Injection is a separate control channel (see section 4).

### 3.1 Protocol input suppression

When `manualBlocked`:
- external protocol input must be suppressed
- interrupts, callbacks, or protocol listeners must not emit domain events
- protocol subscriptions may be detached or ignored
- protocol subprocesses must not be started due to protocol input activity

### 3.2 Bus input suppression (actuators)

For actuator devices that subscribe to a domain bus:

When `manualBlocked`:
- bus input must be suppressed
- domain bus events must not affect device state
- device must not perform hardware IO
- device may keep the subscription attached, but it must behave as a no-op for bus events

This ensures:
- blocked devices are inert w.r.t. external inputs
- inject remains the only supported simulation/control channel while blocked

---

## 4. Device injection contract

### 4.1 `Device.inject(payload)`

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
- may update internal simulated state when `manualBlocked`
- may emit domain events when `manualBlocked` (device-specific)

#### Inject parity

For any device that emits events on a domain bus:

> Every payload shape emitted by the device must be accepted by `inject(payload)`.

This supports recording and replay:
- recorder records domain events
- player injects recorded payloads verbatim

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

## 5. Domain bus interaction rules

This contract uses the following domain rule:

- Sensor devices publish domain events to their domain bus.
- Actuator devices subscribe to their domain bus and apply commands from it.

Both categories must also support inject.

### 5.1 Sensor devices

- publish raw-ish domain events
- do not subscribe to domain buses for input

### 5.2 Actuator devices

- subscribe to their domain bus to receive raw-ish commands
- apply commands only when not blocked
- suppress bus effects when blocked (section 3.2)
- implement `inject(payload)` as an explicit control channel that can act even when blocked

---

## 6. Runtime state reporting

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

## 7. Input channel summary table

| Input source | Allowed when manualBlocked | Notes |
|-------------|----------------------------|------|
| protocol input (hardware/virt) | no | suppressed |
| bus input (actuators) | no | suppressed (no effect) |
| `inject(payload)` | yes | always allowed |

Injection is the only supported simulation/control channel guaranteed to remain active while blocked.
