<!-- docs/architecture/devices/device-inject-parity.md -->
# Device Inject / Emit Parity

This document defines the **inject–emit parity rule** for devices that
participate in recording and playback.

---

## 1. Rule

Any device that emits events on a domain bus **must accept the same payload
shapes via `inject(payload)`**.

In other words:

> If a payload can appear on a device’s domain bus,
> that same payload must be valid input to `inject()`.

---

## 2. Motivation

Recorder and Player operate generically:

- Recorder records raw domain-bus payloads
- Player injects recorded payloads verbatim

To keep Recorder and Player device-agnostic:
- payload compatibility is the responsibility of the device
- no device-specific logic exists in Recorder or Player

---

## 3. Implications for devices

Devices must ensure:

- `inject(payload)` accepts the payload shapes the device emits
- injected payloads may be re-emitted, simulated, or internally handled
- invalid payloads return a stable error code (no throws)

---

## 4. Example (LD2450)

If the device emits:

```js
payload: {
  deviceId,
  publishAs,
  frame
}
```

Then `inject(payload)` must accept that shape and behave sensibly
(e.g. publish the same frame event).

Likewise, if the device emits raw data:

```js
payload: {
  deviceId,
  publishAs,
  base64,
  bytes
}
```

Then `inject(payload)` must also accept that shape.

---

## 5. Non-goals

This rule does not define:

- what devices do internally with injected data
- whether injected data triggers hardware IO
- timing or ordering guarantees
