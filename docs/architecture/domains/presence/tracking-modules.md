<!-- docs/architecture/domains/presence/tracking-modules.md -->
# Presence Tracking Modules (Responsibilities + APIs)

This file documents the current tracking implementation.

Canonical references:
- Requirements / HLD: `presence-tracking-calibration.spec.md`
- Frozen event schemas: `presence-events.contract.md`
- Wiring and bus ownership: `presence-domain.impl.md`

Scope:
- LD2450 ingest to global tracking output
- Tracking internals only
- No calibration implementation details (not implemented)
- No zone enter/exit policy engine (not implemented in Presence domain)

---

# 1) Data Flow Overview

```
LD2450 raw event (presenceRaw:ld2450)
  -> Ld2450IngestAdapter
  -> presence:ld2450Tracks (presenceInternalBus)

TrackingPipeline
  -> RadarSnapshotBuffer
  -> TrackingObservationStage
  -> FusionClusterer
  -> AssociationEngine
  -> KalmanFilterCv2d
  -> presence:globalTracks (presenceInternalBus)
  -> TrackingHealthPublisher -> presence:trackingSnapshotHealth

PresenceController
  -> consumes presence:globalTracks
  -> publishes presence:targets (mainBus)
```

---

# 2) Cross-Cutting Conventions

## 2.1 Time

- `clock.nowMs()` is the runtime clock source.
- `event.ts` is required on bus events.
- `payload.measTs` carries measurement timestamp.
- `measTs` is clamped monotonic per radar in `TrackingPipeline` before snapshot buffering.

## 2.2 Tracking Observation Shape (internal)

```js
{
  measTs: number,
  radarId: number,
  zoneId: string,
  xMm: number,
  yMm: number,
  prov: object | null,
  sourceRadars?: number[]
}
```

## 2.3 Track Shape (internal)

```js
{
  id: string,
  state: 'tentative' | 'confirmed',
  kfState: object | null,
  xMm: number,
  yMm: number,
  vxMmS: number,
  vyMmS: number,
  createdTs: number,
  firstSeenTs: number,
  lastSeenTs: number,
  lastUpdateTs: number,
  lastPredictTs: number,
  lastMeasTsUsed: number,
  lastMeasTsSeen: number,
  confirmHits: number,
  lastRadarId: number | null,
  lastZoneId: string | null,
  lastLocalMm: object | null,
  sourceRadars: Set<number>,
  updatedThisTick: boolean,
  drop: boolean,
  debugLast: object | null
}
```

---

# 3) Module Responsibilities and APIs

## src/domains/presence/presenceController.js

Responsibility:
- Presence domain orchestrator
- Wires ingest adapters + tracking pipeline
- Publishes semantic `presence:targets`

Public API:
```js
constructor({ logger, presenceInternalBus, presenceBus, mainBus, clock, controllerId, controller, devices })
start()
dispose()
get streamKeyWho()
```

Notes:
- `presence:targets` includes confirmed tracks only.
- Payload may include `meta` and periodic `health`.

---

## src/domains/presence/ingest/ld2450IngestAdapter.js

Responsibility:
- Normalize raw LD2450 frames
- Transform local to world coordinates
- Emit `presence:ld2450Tracks`

Public API:
```js
constructor({ logger, clock, controllerId, presenceBus, presenceInternalBus, controllerConfig, devices })
start()
dispose()
get streamKeyWho()
```

Output event:
- `domainEventTypes.presence.ld2450Tracks`

---

## src/domains/presence/ingest/ld2410IngestAdapter.js

Responsibility:
- Debounce raw LD2410 presence
- Emit stable boolean updates

Public API:
```js
constructor({ logger, clock, controllerId, presenceBus, presenceInternalBus, controllerConfig, devices })
start()
dispose()
get streamKeyWho()
```

Output event:
- `domainEventTypes.presence.ld2410Stable`

---

## src/domains/presence/transform/transformService.js

Responsibility:
- Radar-local and world coordinate transforms
- Precomputed transform cache from config

Public API:
```js
constructor({ config, logger })
toLocalMm({ radarId, xMm, yMm }) -> { xMm, yMm }
toWorldMm({ radarId, xMm, yMm }) -> { xMm, yMm }
validateRoundTripWorldMm({ radarId, xMm, yMm }) -> { ok, errMm, w0, w1 }
getYawOffsetsDeg() -> number[]
getDebugForRadar(radarId) -> object | null
```

Behavior note:
- Invalid `radarId` returns `{ xMm: 0, yMm: 0 }`.

---

## src/domains/presence/tracking/trackingPipeline.js

Responsibility:
- Tracking orchestration and lifecycle
- Tick loop and publish of `presence:globalTracks`

Public API:
```js
constructor({ logger, clock, controllerId, presenceInternalBus, controllerConfig })
start()
dispose()
get streamKeyWho()
```

Subscribes:
- `domainEventTypes.presence.ld2450Tracks`

Publishes:
- `domainEventTypes.presence.globalTracks`
- `domainEventTypes.presence.trackingSnapshotHealth` (via `TrackingHealthPublisher`)

---

## src/domains/presence/tracking/snapshot/radarSnapshotBuffer.js

Responsibility:
- Per-radar buffering and snapshot sampling
- Expected radar tracking, status classification, snapshot keying

Public API:
```js
constructor({ clock, cfg })
ingestEntry(radarId, entry, now)
getLatestMeasTs(radarId) -> number
makeSnapshot(now, { debugEnabled }) -> { observations, radars, meta, debug }
cleanup(now)
dispose()
```

---

## src/domains/presence/tracking/observation/trackingObservationStage.js

Responsibility:
- Observation filtering, deduplication, measurement variance scaling

Public API:
```js
constructor({ cfg })
process({ observations, now }) -> { filtered, deduped, measVarMm2ByIdx }
cleanup(now)
dispose()
```

Quality scaling includes:
- bearing edge
- range
- jitter
- stale age
- suspicious jump speed

---

## src/domains/presence/tracking/fusion/fusionClusterer.js

Responsibility:
- Cluster nearby observations
- Apply cross-radar visibility checks
- Produce fused observations + variances

Public API:
```js
constructor({ cfg, transform })
cluster({ observations, measVarMm2ByIdx, now, debugEnabled }) ->
  { observations, measVarMm2ByIdx, debug }
```

---

## src/domains/presence/tracking/associationEngine.js

Responsibility:
- Gated track/measurement association with deterministic tie-breaks

Public API:
```js
constructor({ gateD2Max, tentativePenalty, radarSwitchPenaltyFn })
associate({ tracks, measurements, measVarMm2ByIdx }) ->
  { assignments, unassignedMeas, unassignedTracks }
```

---

## src/domains/presence/tracking/kalmanFilterCv2d.js

Responsibility:
- Constant-velocity 2D Kalman filtering

Public API:
```js
constructor({ procNoiseAccelMmS2, measNoiseBaseMm })
createInitial({ xMm, yMm, initialPosVarMm2, initialVelVarMm2S2 })
predict(state, dtSec)
update(state, z, measSigmaMm)
updateWithDebug(state, z, measSigmaMm)
```

---

## src/domains/presence/tracking/debug/trackingHealthPublisher.js

Responsibility:
- Periodic health reporting on `presenceInternalBus`
- Sanity counters + tick lag stats

Public API:
```js
constructor({ logger, clock, controllerId, presenceInternalBus, cfg, streamKeyWho })
noteSanity(counterKey, details)
computeTickLagStats(now, observations)
maybePublish(now, { snapshotMeta, snapshotRadars, tickLag, meas, fusionDebug })
dispose()
```

---

## src/domains/presence/tracking/debug/trackingDebugFormat.js

Responsibility:
- Debug payload shaping helpers

Public API:
```js
buildDebug({ mode, updatedThisTick, m, assoc, kf })
roundDebug(debug)
mapScale({ v, full, cutoff, scaleMax })
```

---

# 4) Integration Boundaries

TrackingPipeline directly calls:
- `RadarSnapshotBuffer.ingestEntry`
- `RadarSnapshotBuffer.makeSnapshot`
- `TrackingObservationStage.process`
- `FusionClusterer.cluster`
- `AssociationEngine.associate`
- `KalmanFilterCv2d.predict`
- `KalmanFilterCv2d.updateWithDebug`
- `TrackingHealthPublisher.computeTickLagStats`
- `TrackingHealthPublisher.maybePublish`
- `trackingDebugFormat.buildDebug`
- `trackingDebugFormat.roundDebug`

FusionClusterer directly calls:
- `TransformService.toLocalMm`

No other cross-module dependencies are intended.

---

# 5) Config Ownership (Reference)

TrackingPipeline:
- `tracking.mode`
- `tracking.updateIntervalMs`
- `tracking.maxDtMs`
- `tracking.dropTimeoutMs`
- `tracking.association.*`
- `tracking.handover.*`

RadarSnapshotBuffer:
- `layout.ld2450[*].enabled`
- `tracking.snapshot.*`

TrackingObservationStage:
- `quality.*`
- `tracking.kf.measNoiseBaseMm`
- `tracking.snapshot.staleMeasMaxMs`

FusionClusterer:
- `tracking.fusion.*`
- `layout.radarFovDeg`
- `quality.edgeBearingCutoffDeg`
- `quality.rangeCutoffMm`

AssociationEngine:
- `tracking.association.gateD2Max`
- `tracking.association.tentativePenalty`

KalmanFilterCv2d:
- `tracking.kf.*`

TrackingHealthPublisher:
- `tracking.health.*`

Ld2410IngestAdapter:
- `ld2410.enabledDefault`
- `ld2410.debounce.*`
- `layout.ld2410[*]`

