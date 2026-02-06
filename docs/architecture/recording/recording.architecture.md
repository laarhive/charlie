<!-- docs/architecture/recording/recording.architecture.md -->
# Recording and Playback (Recorder / Player)

This document defines the **recording and playback system** used for simulation,
debugging, and reproducible runtime replays in Charlie Core.

It covers:
- High-level design (HLD)
- Recorder behavior
- Player behavior
- Operation-based API
- Operation-based CLI
- Recording format
- RecordingStore responsibilities
- Device isolation during replay
- Playback routing policy (device vs bus sink)

It intentionally does **not** define:
- device internal behavior
- controller semantics
- bus topology or routing rules
- device or controller lifecycle beyond explicit integration points

---

## 1. Goals and non-goals

### 1.1 Goals

The system enables:

- recording events from **explicitly selected buses**
- filtering recorded events by stream, source, type, or predicate
- preserving **global relative timing** of events
- replaying events deterministically through a chosen **sink**
  - `device` sink (implemented): inject payloads into devices
  - `bus` sink (planned): publish raw events back onto buses
- playback controls: speed scaling, pause, resume, stop
- fast debug iteration loops with optional **device isolation**
- mixed replays when required (e.g., sensor simulation + core events)

### 1.2 Non-goals

This system does **not**:
- interpret or normalize event semantics
- guarantee correctness across different controller versions
- snapshot or restore full system state
- manage device start/stop or controller enable/disable

---

## 2. High-level design

### 2.1 Core components

#### Recorder
- subscribes to configured buses
- filters incoming events
- writes a single ordered global timeline (`events[]`)
- records global relative time per event (`tMs`)
- derives a `stream` label per event
- emits a single recording artifact

#### Player
- loads a recording artifact
- selects which events to play
- schedules playback by `tMs`
- dispatches events through a sink chosen by playback routing policy
- supports pause/resume/stop and speed scaling
- optionally isolates devices during playback

#### RecordingService
- orchestrates Recorder and Player sessions
- exposes the operation-based API
- loads macro command files (`.json5`)
- owns the RecordingStore

#### RecordingStore
- persists recordings to disk
- validates recordings on save and load
- enforces base-directory confinement

---

## 3. Core concept: single timeline + streams

### 3.1 What is `stream`?

A **stream** is a stable, record-time-derived label attached to each event.

It is used for:
- grouping related events for debugging and visualization
- filtering and selection during playback
- routing decisions during playback

A stream is **not**:
- a container of events
- a bus
- a sink
- a modification of `raw`

Each event belongs to exactly one stream.

### 3.2 Why a single timeline?

All events are stored in a **single ordered list** to make it easy to:
- inspect causality across the system
- debug interactions (sensor → association → tracking)
- replay behavior deterministically without merging streams

---

## 4. Integration surfaces

### 4.1 Bus subscription (recording)

Recorder depends on buses exposing:

```js
subscribe(handler) -> unsubscribeFn
```

Observed event shape (as observed, not enforced):

```js
{
  bus: string,
  type: string,
  ts: number,
  source: string,
  payload: object
}
```

The `raw` event is stored **verbatim** and must be JSON-serializable.

---

### 4.2 Device injection (device sink)

For device playback, Player dispatches via:

```js
deviceManager.inject(deviceId, payload)
```

- `payload` is `raw.payload`
- `raw` is never modified

---

### 4.3 Bus publish (planned sink)

For bus playback, Player will dispatch via an explicit publish surface:

```js
buses[raw.bus].publish(raw)
```

---

### 4.4 Device isolation (token-scoped blocking)

Player may request isolation from DeviceManager:

```js
deviceManager.blockDevices({ deviceIds, reason, owner })
deviceManager.unblockDevices({ token })
```

Blocking semantics:
- blocking MUST NOT prevent `inject(payload)`
- blocking suppresses hardware acquisition and emissions only

---

## 5. Recording format

### 5.1 Canonical example

```json5
{
  format: "charlie.recording",
  version: "1.0.0",

  meta: {
    recordedAtMs: 1770388882657,

    mode: "rpi4",

    buses: ["presence", "main"],

    filter: {
      include: { streams: ["LD2450A", "association"] }
    }
  },

  timeline: {
    unit: "ms"
  },

  events: [
    {
      tMs: 0,
      stream: "LD2450A",
      raw: {
        bus: "presence",
        type: "presenceRaw:ld2450",
        ts: 1770388882657,
        source: "ld2450RadarDevice",
        payload: {
          deviceId: "LD2450A",
          publishAs: "LD2450A",
          frame: { "...": "..." }
        }
      }
    },

    {
      tMs: 12,
      stream: "association",
      raw: {
        bus: "main",
        type: "presence.association",
        ts: 1770388882669,
        source: "presenceController",
        payload: { "...": "..." }
      }
    }
  ]
}
```

---

### 5.2 Required top-level fields

- `format: string`  
  Must equal `"charlie.recording"`.

- `version: string`  
  Required. Semantic version of the recording format.

- `meta: object`  
  Required. Recording metadata.

  - `meta.recordedAtMs: number`  
    Required. Wall-clock timestamp when recording was finalized.

  - `meta.mode: string`  
    Required. Runtime mode identifier (e.g. `rpi4`, `dev`, `sim`).

  - `meta.buses: string[]`  
    Required. Buses subscribed during recording.

  - `meta.filter?: object`  
    Optional. Snapshot of filter configuration.

- `timeline: object`  
  Required. Currently `{ unit: "ms" }`.

- `events: array`  
  Required. Ordered global event timeline.

---

### 5.3 Event fields

```json5
{
  tMs: 120,
  stream: "LD2450A",
  raw: { ... }
}
```

- `tMs: number`  
  Required. Relative time since recording start (ms). Must be `>= 0`.

- `stream: string`  
  Required. Stream label derived at record time.

- `raw: object`  
  Required. Raw bus event object. Must be JSON-serializable.

---

## 6. Recorder

### 6.1 Ordering guarantees

- Recorder appends events in **ascending observation time**
- `tMs` is computed from a single session start clock
- If time regresses, `tMs` is clamped and a warning is emitted

Player assumes events are already sorted and **never re-sorts**.

---

### 6.2 Stream derivation (with examples)

Stream is derived at record time using the first matching rule:

1. `raw.payload.publishAs`
2. `raw.payload.deviceId`
3. `raw.source`
4. `raw.type`

#### Example 1 — LD2450 radar frame

```js
raw.payload.publishAs === "LD2450A"
→ stream = "LD2450A"
```

#### Example 2 — controller association event

```js
raw.payload.publishAs === undefined
raw.payload.deviceId === undefined
raw.source === "presenceController"
→ stream = "presenceController"
```

#### Example 3 — generic system event

```js
raw.source === undefined
raw.type === "system.tick"
→ stream = "system.tick"
```

Rules:
- stream must be a non-empty string
- `raw` is never modified

---

## 7. Player

### 7.1 Playback assumptions

- `events[]` is already sorted by ascending `tMs`
- events are dispatched strictly in ascending `tMs`
- equal `tMs` preserves original order

---

### 7.2 Routing and dispatch

Routing is playback policy, provided at `play.start`.

#### Canonical routing object

```json5
routing: {
  defaultSink: "bus",
  sinksByStream: {
    LD2450A: "device",
    LD2410A: "device"
  }
}
```

Fields:
- `routing: object`  
  Required at `play.start`.

- `routing.defaultSink: "device" | "bus"`  
  Required. Used when a stream is not explicitly mapped.

- `routing.sinksByStream?: object`  
  Optional. Per-stream overrides:
  - keys are stream names
  - values are `"device"` or `"bus"`

Dispatch rule:
- determine `sink = routing.sinksByStream[stream] ?? routing.defaultSink`
- dispatch accordingly:
  - device sink: `deviceManager.inject(deviceId, raw.payload)`
  - bus sink (planned): `buses[raw.bus].publish(raw)`

---

### 7.3 Device isolation

See §4.4. Isolation is configured only at playback time.

---

## 8. Operation-based API

All operations are expressed as:

```text
{ op: string, params?: object }
```

### Supported operations

- `status`
- `record.start`
- `record.stop`
- `play.load`
- `play.start`
- `play.pause`
- `play.resume`
- `play.stop`

---

## 9. Operation-based CLI

The CLI is a **thin wrapper** over the operation-based API.

### 9.1 Macro command execution

```bash
recording <macro-file.json5>
```

- Executes the macro file verbatim
- Macro file **must contain `op`**
- Can be used for *any* operation

Example macro:

```json5
{
  op: "play.start",
  params: {
    speed: 1,
    routing: {
      defaultSink: "bus",
      sinksByStream: {
        LD2450A: "device",
        LD2410A: "device"
      },
    },
    isolation: { blockDevices: true, unblockOnStop: true }
  }
}
```

---

### 9.2 Interactive commands

```bash
recording status

recording start <macro-file.json5>
recording stop

recording load <recording-file>
recording play [speed]
recording pause
recording resume [speed]
recording halt
```
Note: for `recording start <macro-file.json5>`, macro file **must contain** `op: "record.start"`


---

## 10. RecordingStore

RecordingStore:
- ensures base directory exists
- validates recordings on save/load
- writes JSON5 only
- prevents path escape outside base dir

---

## 11. Summary

This architecture defines recording and playback as a **deterministic event log**
with a single ordered timeline and a record-time-derived `stream` label.

Recorded artifacts are immutable facts.  
Playback behavior (routing, isolation, selection) is policy-driven and supplied
at runtime, enabling flexible simulation and debugging without re-recording.
