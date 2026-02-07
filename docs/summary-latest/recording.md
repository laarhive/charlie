# Recording/Playback implementation handoff (Charlie)

## 1) Goal
Refactor current device-only recorder/player into a **single-timeline event log** recorder + player with:
- recording from configured buses (including `main` if chosen)
- `events[]` stored in ascending time, each event `{ tMs, stream, raw }`
- `raw` stored **verbatim** (must not be modified)
- playback that dispatches events in ascending `tMs` (stable order for ties), and **assumes events are already sorted** (no re-sort)
- playback routing policy provided at `play.start`:
  ```json5
  routing: {
    defaultSink: "bus",
    sinksByStream: { LD2450A: "device", LD2410A: "device" }
  }
  ```
- optional device isolation on playback (device sink only) using token-scoped blocking:
  - `deviceManager.blockDevices({ deviceIds, reason, owner }) -> { ok, token }`
  - `deviceManager.unblockDevices({ token })`

## 2) Locked decisions
- Recording file format:
  - `format: "charlie.recording"`
  - `version: "1.0.0"` (semver)
  - `meta.mode` is **required**
  - `meta.buses` is **required**
  - `meta.source` removed
  - `outFileBase` determines save filename base (sanitize rules already exist)
- Stream derivation (record-time, pure, raw unmodified):
  1) `raw.payload.publishAs`
  2) `raw.payload.deviceId`
  3) `raw.source`
  4) `raw.type`
- No per-track event containers; no `tracks` in recording file.
- Player dispatch order: strictly ascending `tMs` (stable tie order).
- Sinks:
  - device sink dispatch: `deviceManager.inject(deviceId, raw.payload)`
  - bus sink is planned later (publish raw back to `raw.bus`), but implement routing structure now.

## 3) Current code files in repo (to be refactored)
- `src/recording/recorder.js` (currently builds per-device tracks with dtMs)
- `src/recording/player.js` (currently builds schedule from per-device tracks and injects device payload)
- `src/recording/recordingFormat.js` (validates v1 track-based structure)
- `src/recording/recordingStore.js` (save/load JSON5 + confinement)
- `src/recording/recordingService.js` (ops + CLI macro support; currently assumes record.start deviceIds allowlist etc.)
- Architecture doc: `docs/architecture/recording/recording.architecture.md` (finalized in previous chat)

## 4) CLI expectations
- `recording <macro-file.json5>` runs macro with required `{ op, params }`
- `recording start <macro-file.json5>` convenience alias; macro must contain `op: "record.start"`
- keep interactive: `status`, `stop`, `load`, `play [speed]`, `pause`, `resume [speed]`, `halt`
- `recording start` takes no inline params; only macros.

## 5) Implementation tasks (what to change) - suggestions, please comment if ok/nok:
1) Replace recording structure:
  - from `{ devices: { deviceId: { bus, events: [{dtMs, raw}] } } }`
  - to `{ events: [{ tMs, stream, raw }], meta, timeline, format, version }`
2) Replace recorder timing:
  - use session `t0Ms` and store `tMs` per event (global)
  - append events to `events[]` in time order
3) Update validator to new format:
  - check `format`, `version` (semver string), required `meta.mode`, required `meta.buses`, `events[]`
  - ensure each event has `tMs >= 0`, `stream` non-empty, `raw` object, and `events[]` monotonic by `tMs`
4) Update player:
  - schedule directly from `recording.events` (no buildSchedule from tracks)
  - selection filters by stream/source/type (optional; can start minimal)
  - implement routing object `defaultSink` + optional `sinksByStream`
  - for now implement device sink dispatch; bus sink can be stubbed/not implemented yet but routing API should exist
5) Update recordingService ops:
  - `record.start` params: `busNames` required; `filter` optional; no deviceIds allowlist required anymore (selection happens via filter)
  - `record.stop` saves format 1.0.0 with outFileBase naming
  - `play.start` accepts `routing` + `isolation` + `speed`
  - update `handleCli` behavior for macro files and `recording start <macro.json5>`

## 6) Needed integration detail to confirm
- What is the bus publish surface name for later bus-sink? (e.g. `publish`, `emit`) — can be left TODO in code now.
- Confirm DeviceManager provides token-scoped block API:
  - if not yet implemented, we’ll add it or stub it with a clear interface.

## 7) Example LD2450 raw event (must remain unmodified in recording)
(raw includes `bus`, so no duplication needed)
```js
raw: {
  bus: 'presence',
  type: 'presenceRaw:ld2450',
  ts: 1770388882657,
  source: 'ld2450RadarDevice',
  payload: {
    deviceId: 'LD2450A',
    publishAs: 'LD2450A',
    frame: { ... }
  }
}

```
---
* review/discard implementation and the use of handle, handleSafe, handleCli in recordingService it's really confusing'
* fs file handling should be common for the all functions that need to use it (make a helper function?) 


Anything else before coding?
