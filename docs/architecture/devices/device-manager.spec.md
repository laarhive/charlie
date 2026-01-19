
# DeviceManager — Specification

This document specifies **DeviceManager** responsibilities and behavior.

DeviceManager is a core orchestrator:
- selects devices based on the current mode
- owns device lifecycle
- routes injection to devices
- tracks runtime device state via `system:hardware` events

---

## Responsibilities

DeviceManager must:

- Filter devices by `mode`
- Instantiate devices via the device-kind factory
- Start devices in `active` state at startup
- Respect `manualBlocked` config state at startup
- Route calls:
  - `block(deviceId)`
  - `unblock(deviceId)`
  - `inject(deviceId, payload)`
- Track device state based on `system:hardware` events

DeviceManager must not:
- interpret device injection payload content
- parse commands (belongs to controllers)
- implicitly create or start devices during injection

---

## Mode filtering

Only devices whose `modes` include the current mode are registered.

A device outside the mode:
- must not appear in `list()`
- is not injectable
- returns `DEVICE_NOT_FOUND`

---

## Lifecycle ownership

DeviceManager is the owner of device instances.

Device instances are created only via:
- `DeviceManager.start()`
- `DeviceManager.unblock(deviceId)`

DeviceManager must not create/start instances via `inject()`.

---

## Blocking behavior

### `block(deviceId)`

- Sets device state to `manualBlocked`
- If the instance exists and supports blocking, it must be blocked
- Must be idempotent

### `unblock(deviceId)`

- If state is already `active`, must return ok with an idempotent note
- If instance does not exist yet, must create and start it
- Must set state to `active` on success

---

## Injection routing

Injection tooling (CLI, tests, recorder/player) calls:

```js
deviceManager.inject(deviceId, payload)
```

DeviceManager must resolve injection in this order:

1. Device not present in configuration or filtered out by mode  
   → `{ ok: false, error: 'DEVICE_NOT_FOUND' }`

2. Device present but instance not yet created  
   (e.g. configured as `manualBlocked` at startup, or manager not started)  
   → `{ ok: false, error: 'DEVICE_NOT_READY' }`

3. Device instance exists  
   → forward payload verbatim to `device.inject(payload)` and return its result

DeviceManager must not:
- interpret payload content
- parse payload formats
- map payloads between device types

---

## Runtime state tracking (`system:hardware`)

DeviceManager must subscribe to the main bus and track `system:hardware` events for registered devices.

Expected behavior:
- When a device publishes `state: active`, list() should reflect `active`
- When a device publishes `state: degraded`, list() should reflect `degraded`
- When a device is blocked, list() should reflect `manualBlocked`

---

## Listing devices

`list()` must return (at minimum) for each registered device:

- `id`
- `publishAs`
- `domain`
- `kind`
- `state` (tracked state, or `unknown`)
- `started` (instance exists or not)

---

## Error codes

DeviceManager error codes must be stable.

Minimum required codes:

- `DEVICE_NOT_FOUND`
- `DEVICE_NOT_READY`

DeviceManager may use additional codes for internal failures (e.g., start/create failures), but must remain consistent.

---
