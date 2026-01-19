<!-- docs/architecture/device-simulation-recording.md -->
# Device Simulation, Recording, and Playback Architecture

This document defines the **device injection**, **recording**, and **playback** model in Charlie Core.
It formalizes responsibilities, contracts, storage formats, and validation rules.

---

## 1. Design scope

This system enables:

- injecting inputs directly into devices (simulation / testing)
- recording real device outputs with timing information
- replaying recorded device behavior into one or more devices
- composing and merging multiple recordings deterministically

This system is device-level:
- it operates below domain controllers
- it records device outputs from domain buses
- it replays by calling device injection

---

## 2. Device injection contract

### 2.1 `Device.inject(payload)`

All devices must implement:

```js
inject(payload) -> { ok: true } | { ok: false, error: string }
```

#### Rules

- `payload` is device-native:
  - object, number, string, boolean, or null
  - **`undefined` is considered malformed**
  - not a command string
- the device does not parse commands
- the device must not throw for expected cases

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

#### Lifecycle interaction

- `inject(payload)` **must not create or start a device instance**
- device instances are created only via:
  - `DeviceManager.start()`
  - `DeviceManager.unblock(deviceId)`
- if a device instance does not yet exist, injection must not implicitly initialize it

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

## 3. External input suppression rules

### 3.1 Real protocol input (hardware / virt)

When `manualBlocked`:
- external protocol input must be suppressed
- interrupts, callbacks, or protocol listeners must not emit domain events
- protocol subscriptions may be detached or ignored

### 3.2 Injection vs real input

| Input source | Allowed when blocked | Notes |
|-------------|---------------------|------|
| Real hardware | no | suppressed |
| Virtual protocol input | no | suppressed |
| `inject(payload)` | yes | always allowed |

Injection is the **only supported simulation/control channel** guaranteed to remain active while blocked.

---

## 4. Injection routing responsibility

### Decision

- DeviceManager is involved in injection routing.
- DeviceManager owns the device registry and routes injection to the correct device instance.

Injection tooling (CLI, tests, recorder/player) should call:

```js
deviceManager.inject(deviceId, payload)
```

#### DeviceManager.inject resolution rules

DeviceManager must resolve injection requests in the following order:

1. **Device not present in configuration or filtered out by mode**  
   → `{ ok: false, error: 'DEVICE_NOT_FOUND' }`

2. **Device present but instance not yet created**  
   (e.g. configured as `manualBlocked` at startup, or manager not started)  
   → `{ ok: false, error: 'DEVICE_NOT_READY' }`

3. **Device instance exists**  
   → forward payload verbatim to `device.inject(payload)` and return its result

#### Responsibilities

DeviceManager must:
- locate the device instance by id
- forward the payload verbatim to `device.inject(payload)`
- not interpret payload content
- not implicitly create or start device instances during injection

This keeps:
- one registry (no duplicated lookup logic)
- consistent mode filtering (devices outside mode are not injectable)
- explicit lifecycle ownership in one place

---

## 5. Simulation controllers

Two components are defined:

- Recorder
- Player

They share a storage format but have separate responsibilities.

Suggested location:
```text
src/sim/recording/
  recorder.js
  player.js
```

---

## 6. Recorder

### 6.1 Responsibilities

Recorder:
- subscribes to domain buses
- records device output events
- records relative timing (`dtMs`)
- supports one or multiple devices simultaneously

Recorder does not:
- normalize events
- publish events

### 6.2 What is recorded

Recorder captures device-level outputs as close as possible to device behavior:
- bus name
- raw event object (type/source/payload)
- relative timing (`dtMs`)

---

## 7. Player

### 7.1 Responsibilities

Player:
- loads recordings
- merges tracks at runtime
- reconstructs timestamps during playback
- injects payloads into devices via `deviceManager.inject(deviceId, payload)`

Player does not:
- assume devices are active
- interpret payload semantics

### 7.2 Timestamp reconstruction

For each recorded event:
- playback scheduling uses `dtMs` (optionally scaled by speed)
- injected timestamp is computed as:

```text
injectTsMs = startTimeMs + dtMs
```

`startTimeMs` can be:
- current time
- recorded time
- arbitrary caller-supplied time

---

## 8. Recording storage format

This format is designed to:
- preserve raw device outputs
- support multiple device tracks
- support future merging

### 8.1 Top-level structure

```json
{
  "format": "charlie.recording",
  "version": 1,
  "meta": { ... },
  "schema": { ... },
  "devices": { ... }
}
```

### 8.2 Meta section

```json
"meta": {
  "recordedAtMs": 1700000000000,
  "mode": "rpi4",
  "source": "hw",
  "deviceSnapshot": [
    { "id": "buttonGpio1", "kind": "buttonEdge", "domain": "button", "state": "active" },
    { "id": "gpioWatchdog1", "kind": "gpioWatchdogLoopback", "domain": "main", "state": "active" }
  ]
}
```

Fields:
- `recordedAtMs`: absolute timestamp at start of recording
- `mode`: activation profile used
- `source`: label such as `hw`, `virt`, `replay`, `synthetic`
- `deviceSnapshot`: device manager listing at record start (active profile)

### 8.3 Schema section (canonical definition)

```json
"schema": {
  "eventFormat": "domain-bus-raw",
  "payloadFormat": "device-native",
  "canon": {
    "enabled": true
  }
}
```

This section exists so the format can evolve without guessing.

### 8.4 Per-device tracks

Events are stored per device, strictly ordered by time.

```json
"devices": {
  "buttonGpio1": {
    "bus": "button",
    "source": {
      "deviceId": "buttonGpio1",
      "publishAs": "button1",
      "kind": "buttonEdge"
    },
    "canonSchema": "button.edge.v1",
    "events": [
      {
        "dtMs": 0,
        "raw": {
          "type": "buttonRaw:edge",
          "source": "buttonEdgeDevice",
          "payload": { "deviceId": "buttonGpio1", "publishAs": "button1", "edge": "press" }
        },
        "canon": { "edge": "press" }
      }
    ]
  }
}
```

Rules:
- `events[]` must be monotonic by `dtMs` within a track
- `raw` must be recorded as observed (no normalization)
- `canon` is optional; if present it must match `canonSchema`

---

## 9. Playback and merging semantics

### 9.1 Multi-device playback

Player maintains a cursor per track and always selects the next earliest event.

Assumption:
- each track is strictly ordered by `dtMs`

### 9.2 Merging recordings (future)

Merging is supported by treating each device track as an independent stream.

Future extension:
- allow per-track `offsetMs` to shift a recording relative to another
- combine by concatenating tracks and applying offsets at playback time

---

## 10. Validation rules

### 10.1 Recording validation

Recorder must ensure:
- per-device `dtMs` is monotonic
- `raw` events are JSON-serializable
- track identity fields are present (`deviceId`, `publishAs`, `kind`, `bus`)

### 10.2 Playback validation

Player must ensure:
- target devices exist in the current mode (or return `DEVICE_NOT_FOUND`)
- injection is routed through DeviceManager
- devices do not crash playback loop (devices must not throw for expected inject payloads)

Invalid inject payload handling:
- device returns `{ ok: false, error: 'INVALID_INJECT_PAYLOAD' }` (recommended)

---

## 11. Device requirements summary

Every device must:
- implement `inject(payload)`
- accept inject regardless of runtime state
- suppress real input when `manualBlocked`
- not throw for expected inject payloads
- avoid hardware IO when `manualBlocked`

Every device may:
- validate inject payloads (light structural validation recommended)
- simulate internal state when blocked
- emit domain events on inject (device-specific)

---

## 12. Non-goals

Out of scope:
- semantic normalization recording
- core rule recording
- compression/binary formats
- persistence beyond JSON

---
