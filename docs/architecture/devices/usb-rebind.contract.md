<!-- docs/architecture/devices/usb-rebind.contract.md -->
# USB Device Rebinding — DeviceManager & Device Contract

## Overview

This document defines how **USB-backed devices** are rebound to physical endpoints at runtime.

Rebinding allows devices to:
- recover from USB detach/attach
- move across ports
- degrade cleanly when hardware disappears

Rebinding is **explicit**, **device-driven**, and **orchestrated by DeviceManager**.

---

## Responsibility split

### UsbInventory
- Detects physical USB attach/detach
- Emits direct notifications with endpoint data
- Performs no lifecycle actions
- Publishes no bus events

### DeviceManager
- Owns device lifecycle and recovery policy
- Resolves configured devices ↔ physical USB devices
- Passes runtime information to devices
- Publishes USB-related observability events

### Devices
- Open hardware using runtime info only
- Enter degraded state on IO failure
- Enter degraded state when rebound with `null`
- Never scan USB
- Never assume port stability

---

## Control flow rule (strict)

| Path | Purpose | Required |
|----|----|----|
| UsbInventory → DeviceManager | Control / recovery | Yes |
| DeviceManager → main bus | Observability | Yes |
| DeviceManager ← main bus USB events | Control | **No** |

DeviceManager must never depend on bus USB events for decisions.

---

## Device contract: `rebind(runtime)`

USB-backed devices may implement:

```js
rebind(runtime)
```

### Runtime format

```js
{
  serialPath: string | null
}
```

### Semantics

- `rebind({ serialPath })`
  - Tear down any existing transport
  - Attempt to open new transport
  - Reattach protocol subscriptions
  - Publish `system:hardware state: active` on success
  - Publish `system:hardware state: degraded` on failure

- `rebind({ serialPath: null })`
  - Close any open transport
  - Enter degraded state
  - No IO attempts are made

### Rules

- Must be idempotent
- Must not throw for expected failure cases
- Must not scan USB or discover ports

---

## DeviceManager behavior

### Startup

For each configured device with `protocol.usbId`:
1. Resolve `serialPath` via UsbInventory snapshot
2. Create device instance
3. If device implements `rebind`, call `rebind({ serialPath })`
4. Call `start()` according to configuration

---

### On USB detach

For each affected configured device:
- If configured `manualBlocked`: do nothing
- Else:
  - Call `rebind({ serialPath: null })` if supported
  - Device enters degraded state

DeviceManager must not call `block()` or `unblock()` due to USB events.

---

### On USB attach

For each affected configured device:
- If configured `manualBlocked`: do nothing
- Else:
  - Resolve `serialPath`
  - If resolution fails or is ambiguous:
    - Device remains degraded
  - Else:
    - Call `rebind({ serialPath })`

---

## Ambiguity handling

If `{ vid, pid }` matches multiple physical devices:
- UsbInventory reports `USB_AMBIGUOUS`
- DeviceManager must not bind arbitrarily
- Device remains degraded until ambiguity is resolved

---

## Observability (DeviceManager)

DeviceManager publishes USB-related observability events:

```js
{
  type: 'system:hardware',
  payload: {
    subsystem: 'usb',
    action: 'attached' | 'detached' | 'rebind_attempted' | 'rebind_succeeded' | 'rebind_failed',
    source: 'deviceManager',
    eventId?: string,
    relatedDevices: [deviceId],
    usbId,
    detail?: { error }
  }
}
```

These events:
- are informational only
- are suitable for taps, logs, and recording
- must never be required for control flow

---

## Summary

USB rebinding follows a strict flow:

```
UsbInventory detects physical change
        ↓
DeviceManager decides policy
        ↓
device.rebind(runtime)
```

Discovery, orchestration, and IO remain strictly separated.

This guarantees:
- deterministic recovery
- platform-agnostic devices
- clean observability without feedback loops
