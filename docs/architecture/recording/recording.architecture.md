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
- `deviceId` is resolved from the event’s `stream`

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
- blocking is token-scoped; multiple tokens may block the same device
- a device resumes its prior operational state only when all block tokens are released

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
    Optional. Snapshot of filter configuration at record time.  
    Filter semantics are recorder-defined and may evolve across versions.

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

Note: controller-originated events typically derive streams from `raw.source`,
while device-originated events derive streams from `raw.payload.publishAs`.

Rules:
- stream must be a non-empty string
- `raw` is never modified

---

## 7. Player

### 7.2 Routing and dispatch

Routing is playback policy, provided at `play.start`.

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

### 9.1 Macro command execution

```bash
recording start <macro-file.json5>
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


## Appendix A — StreamKey-based Recording & Playback (Delta)

This section documents the transition from **derived streams** to **explicit `streamKey` usage**
in the recording and playback system.

It is a delta to the original architecture, not a replacement.

---

## A.1 Motivation

Earlier versions derived a `stream` label heuristically from observed events
(e.g. `publishAs`, `deviceId`, `source`, `type`).

This approach had limitations:
- ambiguity across device/controller boundaries
- fragile derivation rules
- difficult validation
- non-deterministic behavior when payloads evolve

To resolve this, Charlie now uses an **explicit `streamKey`** published with every event.

---

## A.2 `streamKey` — authoritative event identity

### Definition

Every published event MUST include a `streamKey` field.

```js
streamKey: "who::what::where"
```

Where:

| Segment | Meaning |
|------|--------|
| `who` | Publishing entity (device, controller, manager) |
| `what` | Event semantic or raw type |
| `where` | Bus identifier |

Example:

```js
streamKey: "LD2450A::presenceRaw:ld2450::presence"
```

### Properties

- `streamKey` is **mandatory**
- it is **authoritative** for recording and playback
- it is **stable across versions**
- it is **not derived** by Recorder or Player
- it is **validated** by the EventBus

`streamKey` replaces all heuristic stream derivation logic.

---

## A.3 Relationship to existing fields

| Field | Role |
|----|----|
| `streamKey` | deterministic routing / recording identity |
| `source` | human-readable emitter identity |
| `type` | semantic classification |
| `payload.deviceId / publishAs` | domain-specific metadata |

`source` is retained for debugging and backward compatibility.
It may match `streamKey.who` but is not required to.

---

## A.4 Recording changes

### Event capture

Recorder now stores events exactly as observed:

```js
{
  tMs,
  streamKey,
  raw: {
    bus,
    type,
    ts,
    source,
    streamKey,
    payload
  }
}
```

Notes:
- `streamKey` is copied verbatim
- Recorder no longer computes or modifies stream identity
- ordering and timing behavior are unchanged

---

### Streams observed metadata

Recorder stores a summary of observed streams in recording metadata:

```js
meta: {
  streamsObserved: {
    "LD2450A::presenceRaw:ld2450::presence": {
      kind: "device"
    },
    "presenceController::presence:targets::main": {
      kind: "controller"
    }
  }
}
```

Rules:
- `kind` is **best-effort metadata**
- valid values include: `device`, `controller`, `system`, `unknown`
- `kind` is informational only and MUST NOT affect playback behavior

---

## A.5 Playback routing changes

### Routing by `streamKey`

Playback routing is now defined exclusively via `streamKey`:

```json5
{
  op: "play.start",
  params: {
    routingByStreamKey: {
      "LD2450A::presenceRaw:ld2450::presence": "device",
      "presenceController::*::main": "bus"
    }
  }
}
```

Rules:
- only streams explicitly listed are played
- all other streams are discarded
- no implicit selection exists
- no secondary filters are applied

### Sink resolution

For each event:

1. match `streamKey` against `routingByStreamKey`
2. if no match → event is skipped
3. otherwise route to:
  - `device` → `deviceManager.inject(deviceId, payload)`
  - `bus` → `bus.publish(raw)`

---

## A.6 Default playback behavior

If not overridden:

- default sink MAY be inferred from `streamsObserved[].kind`
- this inference is **optional**
- operators are expected to supply explicit routing for deterministic runs

`kind` is a helper only — never a decision authority.

---

## A.7 Validation guarantees

With `streamKey` enforced:

- Recorder no longer needs to infer identity
- Player no longer guesses routing intent
- mis-published events fail fast at the bus boundary
- recording files are self-describing
- mixed recordings (device + controller + system) are deterministic

---

## A.8 Backward compatibility

- Existing recordings without `streamKey` are considered legacy
- New recordings MUST include `streamKey`
- New code MUST NOT rely on derived stream logic

---

## A.9 Summary

- `streamKey` is now the single source of truth for event identity
- Recorder records, Player routes — neither interprets semantics
- Routing decisions are explicit, declarative, and operator-controlled
- Recording artifacts remain immutable and future-proof

This completes the transition to deterministic, contract-driven replay.
