<!-- docs/architecture/devices/usb-inventory.spec.md -->
# UsbInventory — Specification

## Overview

**UsbInventory** is a system-level component responsible for **USB device discovery and tracking**.

It provides:
- a live, in-memory inventory of attached USB devices
- deterministic attach/detach notifications for control flow

UsbInventory is **pure discovery and IO**.

It does **not**:
- know about configured devices
- manage device lifecycle
- publish to the main bus
- interact with devices directly

---

## Responsibilities

UsbInventory must:

- Discover USB devices on the host platform
- Maintain a live mapping of physical USB devices to endpoints
- Emit **direct in-process events** for control flow
- Normalize USB identity consistently across platforms
- Perform periodic rescans as a safety net

UsbInventory must not:

- Resolve configured devices
- Decide recovery actions
- Call device methods
- Publish observability events

---

## Identity model

Each USB device is identified by a normalized **usbId**:

```js
{
  vid: string,     // lowercase hex, no prefix (e.g. "10c4")
  pid: string,     // lowercase hex, no prefix (e.g. "ea60")
  serial?: string,      // optional, trimmed; case preserved
  hubPosition?: string, // optional, digits; derived from USB topology (Windows + Linux)
  iface?: string        // optional, lowercase hex byte (e.g. "00")
}
```

Normalization rules:
- `vid` / `pid` are lowercase hex strings
- no `0x` prefix
- `serial` is optional and not modified beyond trimming
- `hubPosition` is optional; must be digits; leading zeros are normalized away
- `iface` is optional; must be a 2-hex-digit string

Notes:
- `hubPosition` is best-effort and may not be available on all hosts.
- `hubPosition` is not globally unique: if multiple identical adapters exist on different hubs but same port index, the match can still be ambiguous.

---

## Endpoint model

Each USB device may expose one or more endpoints.

An endpoint represents an **openable path** on the current platform.

```js
{
  serialPath: string | null, // preferred open path if available
  ttyPath?: string | null,   // unstable fallback (Linux)
  platform: 'linux' | 'windows',
  debug?: {
    manufacturer?: string,
    product?: string
  }
}
```

Notes:
- On Linux, `serialPath` typically maps to `/dev/serial/by-id/...`
- On Windows, `serialPath` is the COM port name (e.g. `"COM7"`)
- `serialPath` must be usable by Node.js serial libraries

---

## Public API

### Lifecycle

```js
start()
dispose()
```

- `start()` begins discovery and event emission
- `dispose()` stops discovery and releases resources

---

### Snapshot access

```js
getSnapshot() -> Map<usbId, endpoints[]>
```

Returns a **copy** of the current inventory state.

The returned structure must not be mutable by the caller.

---

### Path resolution helper

```js
resolveSerialPath(usbId)
  -> { ok: true, serialPath: string | null }
  |  { ok: false, error: 'USB_NOT_FOUND' | 'USB_AMBIGUOUS' }
```

Resolution rules:
- No matching device → `USB_NOT_FOUND`
- Exactly one matching device → return best `serialPath`
- Multiple matching devices → `USB_AMBIGUOUS`

UsbInventory does not decide how ambiguity is handled beyond reporting it.

---

## Control-path events (direct)

UsbInventory emits **in-process events** used for control flow.

```js
on('attached', handler)
on('detached', handler)
```

### attached

```js
{
  usbId,
  endpoints
}
```

### detached

```js
{
  usbId
}
```

Notes:
- Endpoint changes are represented as `detached` followed by `attached`
- This guarantees simple, deterministic state transitions

---

## Platform behavior

### Linux (Debian)

- Uses udev for attach/detach notifications
- Performs an initial scan at startup
- Performs periodic rescans as a safety net
- Rescan interval is configurable

### Windows

- Uses periodic enumeration and diffing
- Attach/detach events are synthesized
- Scan interval should be short but configurable

Platform differences are **fully encapsulated** inside UsbInventory.
