<!-- docs/architecture/simulation/device-simulation-recording.md -->
# Device Simulation Recording and Playback (Recorder / Player)

This document defines the **recording and playback system** used for device-level
simulation in Charlie Core.

This document focuses on:
- Recorder behavior
- Player behavior
- interaction points with **domain buses** and **DeviceManager.inject**

It intentionally does **not** define:
- device internal behavior
- device lifecycle or blocking semantics
- DeviceManager responsibilities beyond injection

---

## 1. Scope and intent

This system enables:

- recording device-originated events from **domain buses**
- preserving relative timing between events
- replaying recorded behavior by injecting payloads back into devices
- controlling playback (speed, pause, resume)

The system operates **below domain controllers** and **above devices**.

---

## 2. Interaction surfaces (owned dependencies)

Recorder and Player rely on the following existing surfaces.

### 2.1 Domain buses

- Recorder subscribes to domain buses (`presence`, `vibration`, `button`, etc.)
- The `main` bus is **explicitly excluded**
- Buses are enumerated at session start; no dynamic bus discovery

Observed event shape (as observed, not enforced):

```js
{
  type: string,
  ts: number,
  source: string,
  payload: {
    deviceId: string,
    publishAs?: string,
    ...deviceNativeFields
  }
}
```

Recorder does not interpret event semantics.

---

### 2.2 DeviceManager injection

Player injects events exclusively via:

```js
deviceManager.inject(deviceId, payload)
```

- `deviceId` is resolved from recorded data
- `payload` is the recorded payload (verbatim)

Recorder and Player do not start, stop, block, or unblock devices.

---

## 3. Session model

Recorder and Player are **session-scoped**:

- one Recorder instance per recording session
- one Player instance per playback session
- no global always-on recorder or player

Each session owns:
- its subscriptions
- its timing state
- its selection filters
- its lifecycle (`start`, `stop`, etc.)

---

## 4. Recorder

### 4.1 Responsibilities

Recorder:

- subscribes to all configured **domain buses**
- records events emitted by **selected devices only**
- records relative timing per device (`dtMs`)
- produces a single recording artifact per session

Recorder does **not**:

- record main-bus events
- record non-device events
- normalize, reinterpret, or mutate payloads
- publish events

---

### 4.2 Device selection

Recorder is instantiated with an explicit allowlist:

```text
recordedDeviceIds: string[]
```

Only events where:

```text
event.payload.deviceId ∈ recordedDeviceIds
```

are recorded.

---

### 4.3 Empty tracks

For every requested `deviceId`:

- a device track **must exist**
- if no events were observed, the track’s `events[]` array is empty

This guarantees structural consistency across recordings.

---

### 4.4 Timing model

- Timing is computed using the recorder’s clock at observation time
- `dtMs` is relative to the **first recorded event of that device**
- `dtMs` is monotonic per device track

No global ordering across devices is assumed at record time.

---

### 4.5 Recorded data

For each event, Recorder stores:

- the bus name
- the raw event object as observed
- relative timing (`dtMs`)

Payloads are stored verbatim and must be JSON-serializable.

---

## 5. Player

### 5.1 Responsibilities

Player:

- loads a recording
- selects which device tracks to play
- reconstructs timing during playback
- injects recorded payloads into devices
- supports speed scaling and pause/resume

Player does **not**:

- publish events directly to buses
- interpret payload semantics
- manage device lifecycle or state

---

### 5.2 Playback injection mapping

For each recorded event:

- `deviceId` is taken from the track key
- injected payload is exactly:

```text
recordedEvent.raw.payload
```

Injection call:

```js
deviceManager.inject(deviceId, recordedEvent.raw.payload)
```

No transformation or normalization is performed.

> Note: Devices participating in recording/playback are expected to accept,
> via `inject(payload)`, the same payload shapes they emit on domain buses.

> Dependency note:
> Recorder and Player rely on the **inject/emit parity rule** defined in:
>
> `docs/architecture/devices/device-inject-parity.md`
>
> Devices participating in recording/playback are expected to accept, via
> `inject(payload)`, the same payload shapes they emit on domain buses.

---

### 5.3 Timing reconstruction

Playback time is computed as:

```text
injectTimeMs = playbackStartMs + (dtMs / speed)
```

Where:
- `speed = 1` → real-time
- `speed > 1` → accelerated playback
- `speed < 1` → slowed playback

---

### 5.4 Pause and resume

- `pause()` stops scheduling future injections
- `resume()` continues from the same logical playback position
- `stop()` aborts playback and clears all pending timers

Playback order is deterministic:
- ordered by scheduled injection time
- ties are broken lexicographically by `deviceId`

---

## 6. Recording format (canonical)

```json
{
  "format": "charlie.recording",
  "version": 1,

  "meta": {
    "recordedAtMs": 1700000000000,
    "mode": "rpi4",
    "source": "hw",
    "requestedDeviceIds": ["LD2450A", "LD2410A"]
  },

  "schema": {
    "eventFormat": "domain-bus-raw",
    "payloadFormat": "device-native"
  },

  "devices": {
    "LD2450A": {
      "bus": "presence",
      "events": [
        {
          "dtMs": 0,
          "raw": {
            "bus": "presence",
            "ts": 1769802919860,
            "source": "ld2450RadarDevice",
            "payload": {
              "deviceId": "LD2450A",
              "publishAs": "LD2450A",
              "frame": { "...": "..." }
            }
          }
        }
      ]
    },

    "LD2410A": {
      "bus": "presence",
      "events": []
    }
  }
}
```

Rules:
- one track per requested device
- tracks may have empty `events[]`
- per-device `dtMs` is strictly monotonic
- injected payloads are exactly what was recorded

---

## 7. Validation rules

### 7.1 Recorder validation

Recorder must ensure:

- only selected devices are recorded
- all requested device tracks exist
- per-device `dtMs` is monotonic
- raw events are JSON-serializable

---

### 7.2 Player validation

Player must ensure:

- target devices exist in the current runtime configuration
- injection is routed via `DeviceManager.inject`
- injection errors do not crash the playback loop

---

## 8. Non-goals

This system does **not** define:

- device behavior
- device blocking semantics
- DeviceManager lifecycle rules
- controller-level or rule-level recording
- semantic normalization
- binary or compressed formats
