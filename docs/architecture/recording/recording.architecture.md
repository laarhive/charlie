<!-- docs/architecture/recording/recording.architecture.md -->
# Recording and Playback (Recorder / Player)

This document defines the **architecture and responsibilities** of the recording
and playback system in Charlie Core.

It covers:
- High-level design (HLD)
- Recorder behavior
- Player behavior
- Recording format
- RecordingStore responsibilities
- Device isolation during replay
- Playback routing policy (device vs bus sink)


**Related documents**
- Recording CLI & profiles:  
  `docs/architecture/recording/recording.cli-and-profiles.md`
- Event template / pretty-print format:  
  `docs/architecture/recording/event-template-format.md`

---

## 1. Goals and non-goals

### 1.1 Goals

The system enables:

- recording events from **explicitly selected buses**
- filtering recorded events by **streamKey**
- preserving **global relative timing**
- deterministic replay through an operator-chosen **sink**
  - `device` sink (implemented)
  - `bus` sink (planned)
- playback control: speed, pause, resume, stop
- fast debug and calibration loops
- optional **device isolation** during playback
- immutable, self-describing recording artifacts

### 1.2 Non-goals

This system does **not**:

- interpret or normalize event semantics
- guarantee correctness across controller versions
- snapshot or restore full system state
- manage device lifecycle beyond explicit injection / isolation hooks

---

## 2. High-level design

### 2.1 Core components

#### Recorder
- subscribes to configured buses
- filters events by `streamKey`
- records a single ordered timeline (`events[]`)
- computes relative time (`tMs`)
- records `streamsObserved` metadata
- emits a recording artifact

#### Player
- loads a recording artifact
- schedules events by `tMs`
- dispatches events via routing policy
- supports pause/resume/stop and speed scaling
- optionally blocks devices during playback

#### RecordingService
- orchestrates Recorder and Player
- loads and resolves **profiles**
- resolves final execution params
- owns RecordingStore
- exposes the operation-based API

#### RecordingStore
- persists recordings to disk
- validates recordings on save/load
- applies formatting templates
- enforces base-directory confinement

---

## 3. Core model: single timeline + explicit streams

### 3.1 Single global timeline

All events are stored in a **single ordered array**:

```text
events[] ordered by observation time
```

This allows:
- causal inspection across subsystems
- deterministic replay
- interval slicing without stream merging

Player **never reorders** events.

---

### 3.2 streamKey — authoritative event identity

Every published event **must include** a `streamKey`.

```text
streamKey = who::what::where::why
```

Matching semantics **ignore `why`** and operate on:

```text
who::what::where
```

Properties:
- mandatory on all events
- validated by EventBus
- authoritative for:
  - recording selection
  - playback routing
- never derived or modified by Recorder or Player

`streamKey` replaces all heuristic stream derivation.

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
  type: string,
  ts: number,
  source: string,
  streamKey: string,
  payload: object
}
```

Notes:
- `streamKey` is mandatory and validated upstream
- bus identity is implicit via subscription
- the raw event is stored **verbatim**

---

### 4.2 Device injection (device sink)

For device playback, Player dispatches via:

```js
deviceManager.inject(deviceId, payload)
```

Rules:
- `payload` is `raw.payload`
- `raw` is never modified
- `deviceId` is resolved from `payload.publishAs`
- unresolved `publishAs` results in a warning and skip

---

### 4.3 Bus publish (planned sink)

For bus playback, Player will dispatch via:

```js
buses[busId].publish(raw)
```

Where `busId` is resolved from `streamsObserved[streamKey].bus`.

---

### 4.4 Device isolation

Player may request isolation from DeviceManager:

```js
deviceManager.blockDevices({ deviceIds, reason, owner })
deviceManager.unblockDevices({ token })
```

#### blockDevices modes

`blockDevices` supports **two forms**:

- `blockDevices: true`  
  Automatic mode. Player derives the device set by inspecting all events that:
  - fall within the playback interval
  - route to the `device` sink  
    All referenced `payload.publishAs` values are resolved and blocked.

- `blockDevices: string[]`  
  Explicit mode. Each entry is treated as a `publishAs` identifier.
  Unresolvable entries are logged and skipped.

#### Isolation semantics

- blocking suppresses hardware acquisition/emission only
- `inject()` must continue to work
- blocking is **token-scoped**
- multiple tokens may block the same device
- devices resume only after all tokens are released

---

## 5. Recording format

The recording format is validated on save/load.
This section defines **structural invariants only**.
Pretty-printing is defined in `event-template-format.md`.

### 5.1 Top-level structure

```json5
{
  format: "charlie.recording",
  version: "1.0.0",

  meta: { ... },

  timeline: { unit: "ms" },

  streamsObserved: { ... },

  events: [ ... ]
}
```

---

### 5.2 Metadata (`meta`)

`meta` is required and includes:

- `recordedAtMs` (number)  
  Wall-clock time when recording finalized.

- `mode` (string)  
  Runtime mode injected by RecordingService.

- `buses` (string[])  
  Buses subscribed during recording.

- `profileFile` (string)  
  Profile filename used to initiate recording.

- `recordParams` (object)  
  Fully resolved params used for recording.

- additional arbitrary keys (allowed)

---

### 5.3 streamsObserved

```json5
streamsObserved: {
  "<streamKey>": {
    kind: "device" | "controller" | "system" | "unknown",
    bus: "<busId>"
  }
}
```

Rules:
- `bus` is authoritative for bus-sink playback
- `kind` is best-effort metadata
- neither affects routing decisions

---

### 5.4 Event entries

```json5
{
  id: "AB3f-12",
  i: 12,
  tMs: 240,
  raw: { ... }
}
```

- `id`  
  Session-scoped identifier (`<shortId>-<counter>`).

- `i`  
  Strictly increasing event index.

- `tMs`  
  Relative time since recording start (ms).

- `raw`  
  Verbatim bus event, including `streamKey`.

---

## 6. Recorder behavior

- events appended in observation order
- `tMs` derived from a single session clock
- non-monotonic time is clamped and warned
- Recorder never mutates events
- Recorder never interprets semantics

---

## 7. Player behavior

### 7.1 Scheduling

- events scheduled by `tMs`
- speed scaling is applied at playback time
- pause/resume preserves logical time

### 7.2 Routing

Routing is provided at playback start and matched by `streamKey`.

For each event:
1. match `streamKey` against routing rules
2. if no match → discard
3. otherwise dispatch to:
  - `device` sink
  - `bus` sink (planned)

---

### 7.3 Event interval playback

Playback may be limited to an **event index range**:

```js
eventRange: [from, to]
```

Rules:
- indices refer to `event.i`
- bounds are inclusive
- sparse indices are allowed
- out-of-range bounds are clamped

---

## 8. RecordingService responsibilities

RecordingService:

- loads and validates profiles
- resolves base params + variant overrides
- injects runtime mode into metadata
- ensures Recorder and Player receive **final params only**
- provides operation-based API and CLI integration

Profiles, variants, and CLI behavior are defined in  
`recording.cli-and-profiles.md`.

---

## 9. RecordingStore responsibilities

RecordingStore:

- ensures base directory exists
- validates recordings on save/load
- applies event formatting templates
- writes JSON5 only
- prevents path escape outside base dir

---

## 10. Summary

The recording system treats events as **immutable facts** recorded on a single
global timeline.

- `streamKey` is the single source of truth for identity
- Recorder records, Player routes
- playback behavior is policy-driven
- profiles define intent; recordings remain immutable

This separation enables deterministic replay, safe evolution, and fast
debug/calibration cycles without re-recording.
