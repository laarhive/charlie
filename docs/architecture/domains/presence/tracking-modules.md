<!-- docs/architecture/presence/tracking-modules.md -->
# Presence Tracking Modules (Responsibilities + APIs)

This document is the **developer reference** for the LD2450-based tracking subsystem.

It defines:
- module responsibilities
- public APIs
- internal data shapes
- config ownership per module
- call graph boundaries

It is intentionally implementation-adjacent and intended to remain stable during refactoring.

Canonical references:
- Requirements / HLD:  
  `[presence-tracking-calibration.spec.md](presence-tracking-calibration.spec.md)`
- Frozen event schemas (v1 contracts):  
  `[presence-events.contract.md](presence-events.contract.md)`
- Current wiring and bus ownership:  
  `[presence-domain.impl.md](presence-domain.impl.md)`

Scope:
- LD2450-based tracking only
- No LD2410 logic here (see spec appendix if needed)
- No semantic presence policy here (zone engine is separate)

---

# 1) Data Flow Overview

```
LD2450 Ingest Adapter
  └─ publishes presence:ld2450Tracks (presenceInternalBus)

TrackingPipeline (orchestration)
  ├─ RadarSnapshotBuffer (temporal sync + buffering)
  ├─ TrackingObservationStage (filter + dedup + variance inflation)
  ├─ FusionClusterer (cross-radar merge)
  ├─ AssociationEngine (track-to-measurement assignment)
  ├─ KalmanFilterCv2d (state estimation)
  └─ TrackingHealthPublisher (monitoring + sanity)
```

TrackingPipeline owns:
- track lifecycle
- predict/update loop
- publish of `presence:globalTracks`
- coordination of submodules

All other modules are pure(ish) components.

---

# 2) Cross-Cutting Conventions

## 2.1 Time

- `now` always comes from `clock.nowMs()` (injected monotonic clock).
- `event.ts` (ingest receive timestamp) is required.
- `measTs` comes from ingest payload and represents measurement time.
- `measTs` is clamped monotonic per radar to avoid backward time.

Tracking logic must never rely on wall clock.

---

## 2.2 Measurement Shape (Tracking Internal)

A measurement is the atomic unit for association and filtering.

```js
{
  measTs: number,
  radarId: number,
  zoneId: string,

  xMm: number,   // world coordinates
  yMm: number,

  prov: object | null,  // minimal provenance (debug-aware)

  // optional (set by fusion)
  sourceRadars?: number[]
}
```

Notes:
- `prov` may be stripped down when debug is disabled.
- All coordinates are world-frame.

---

## 2.3 Track Shape (Tracking Internal)

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

  confirmHits: number,

  lastRadarId: number | null,
  lastZoneId: string | null,

  sourceRadars: Set<number>,

  updatedThisTick: boolean,
  drop: boolean,

  debugLast: object | null
}
```

---

# 3) File-by-File Responsibilities and APIs

---

## src/domains/presence/presenceController.js

### Responsibility

Domain orchestrator.

Owns:
- ingest adapter instances
- tracking pipeline instance
- bus wiring

It is the only component that:
- subscribes to raw presence bus
- publishes to main bus (semantic outputs)

---

### Public API

```js
constructor({ logger, clock, buses, controllerConfig })
start()
dispose()
```

---

### Emits / Subscribes

- Subscribes: `presenceRaw:ld2450`
- Publishes:
  - `presence:ld2450Tracks` (via ingest)
  - `presence:globalTracks` (from tracking)
  - main bus semantic events (e.g., `presence:targets`)

---

## src/domains/presence/ingest/ld2450IngestAdapter.js

### Responsibility

Normalize raw LD2450 device frames into domain events.

Responsibilities:
- validate frame shape
- resolve `publishAs` → `radarId`
- enforce `enabled` / `degraded`
- attach `event.ts`
- emit `presence:ld2450Tracks`

Event schema is defined in:

```
docs/architecture/domains/presence/presence-events.contract.md
```

---

### Public API

```js
constructor({ logger, clock, presenceInternalBus, config })
start()
dispose()
```

---

### Output Contract (Minimum)

Event type:

```
domainEventTypes.presence.ld2450Tracks
```

Required payload fields:

```js
{
  radarId: number,
  publishAs: string,
  zoneId: string,
  measTs: number,

  tracks: [
    {
      world: { xMm, yMm },
      provenance?: object
    }
  ],

  meta?: {
    slotCount?: number,
    detectionCount?: number
  }
}
```

---

## src/domains/presence/transform/transformService.js

### Responsibility

Radar-local ↔ world coordinate transforms.

Must be:
- deterministic from config
- stateless except for config

Used by:
- ingest
- fusion visibility gating
- debug rendering

---

### Public API

```js
constructor({ config, logger })

toLocalMm({ radarId, xMm, yMm }) -> { xMm, yMm } | null
toWorldMm({ radarId, xMm, yMm }) -> { xMm, yMm } | null
```

---

## src/domains/presence/tracking/trackingPipeline.js

### Responsibility

Full orchestration of tracking.

Owns:
- track lifecycle
- tick loop
- predict → associate → update
- new track spawning
- drop policy
- publishing `presence:globalTracks`

Delegates:
- buffering → RadarSnapshotBuffer
- filtering/variance → TrackingObservationStage
- clustering → FusionClusterer
- assignment → AssociationEngine
- state math → KalmanFilterCv2d
- monitoring → TrackingHealthPublisher
- debug shaping → trackingDebugFormat

---

### Public API

```js
constructor({
  logger,
  clock,
  controllerId,
  presenceInternalBus,
  controllerConfig
})

start()
dispose()

get streamKeyWho()
```

---

### Subscribes

```
domainEventTypes.presence.ld2450Tracks
```

---

### Publishes

```
domainEventTypes.presence.globalTracks
domainEventTypes.presence.trackingSnapshotHealth
```

Event schema defined in:

```
presence-events.contract.md
```

---

## src/domains/presence/tracking/snapshot/radarSnapshotBuffer.js

### Responsibility

Temporal synchronization + per-radar buffering.

Owns:
- per-radar ring buffer
- monotonic measTs clamping
- stale/missing classification
- snapshot meta
- TTL cleanup

---

### Public API (Suggested)

```js
constructor({ clock, cfg })

ingestLd2450TracksEvent(event)

makeSnapshot(now) ->
  {
    measurements,
    radars,
    meta,
    debug | null
  }

cleanup(now)
```

---

### Snapshot Output

```js
{
  measurements: measurement[],

  radars: [
    {
      radarId,
      status,       // fresh|stale|missing
      included,
      advanced,
      measTs,
      recvTs,
      ageMs,
      recvLagMs,
      detectionCount,
      slotCount,
      publishAs,
      zoneId
    }
  ],

  meta: { ... },

  debug?: { radars: [...] }
}
```

---

## src/domains/presence/tracking/observation/trackingObservationStage.js

### Responsibility

Measurement quality processing stage.

Applies:

- bearing cutoff filtering
- de-duplication
- variance inflation:
  - edge bearing scaling
  - range scaling
  - jitter scaling
  - stale scaling
  - jump scaling

Maintains per-key jitter/jump history.

---

### Public API (Suggested)

```js
constructor({ clock, cfg })

process({ measurements, now }) ->
  {
    measurements,
    measVarMm2ByIdx,
    meta
  }

cleanup(now)
```

---

### Keying Rules

Prefer per-slot key:

```
slot:${publishAs}:${slotId}
```

Fallback:

```
radar:${radarId}
```

---

## src/domains/presence/tracking/fusion/fusionClusterer.js

### Responsibility

Cross-radar measurement merging.

Rules:

- distance gate (`clusterGateMm`)
- same-radar merges allowed
- cross-radar merges only if visible from both radars
- weighted centroid (inverse variance)
- fused variance = `1 / sum(weights)`
- representative provenance selection

---

### Public API (Suggested)

```js
constructor({ cfg, transform, debugEnabled })

cluster({
  measurements,
  measVarMm2ByIdx,
  now
}) ->
  {
    measurements,
    measVarMm2ByIdx,
    debug
  }
```

---

## src/domains/presence/tracking/associationEngine.js

### Responsibility

Track ↔ measurement assignment.

Uses:
- Mahalanobis distance
- `gateD2Max`

---

### Public API

```js
constructor({ gateD2Max })

associate({
  tracks,
  measurements,
  measVarMm2ByIdx
}) ->
  {
    assignments: Map<trackId, measIdx>,
    unassignedMeas: number[]
  }
```

---

## src/domains/presence/tracking/kalmanFilterCv2d.js

### Responsibility

Constant-velocity 2D Kalman Filter.

State: `[x, y, vx, vy]`

---

### Public API

```js
constructor({
  procNoiseAccelMmS2,
  measNoiseBaseMm
})

createInitial({
  xMm,
  yMm,
  initialPosVarMm2,
  initialVelVarMm2S2
})

predict(state, dtSec)

updateWithDebug(state, { xMm, yMm }, sigmaMm)
  -> { state, innovationMm, sigmaMm }
```

---

## src/domains/presence/tracking/debug/trackingHealthPublisher.js

### Responsibility

Periodic health publish.

Includes:

- snapshot meta
- tick lag stats
- sanity counters
- degraded flags
- fusion debug
- publish interval enforcement
- counter reset after publish

---

### Public API (Suggested)

```js
constructor({
  clock,
  cfg,
  presenceInternalBus,
  controllerId,
  streamKeyWho
})

noteSanity(code, details)

maybePublish(now, {
  snapshotMeta,
  snapshotRadars,
  tickLag,
  measCounts,
  fusionDebug
})

reset()
```

---

## src/domains/presence/tracking/debug/trackingDebugFormat.js

### Responsibility

Debug-only formatting utilities.

Keeps debug shaping separate from tracking logic.

---

### Public API (Suggested)

```js
buildTrackDebug(...)
roundTrackDebug(debug)
```

---

# 4) Integration Boundaries

TrackingPipeline calls:

- RadarSnapshotBuffer.ingestLd2450TracksEvent
- RadarSnapshotBuffer.makeSnapshot
- TrackingObservationStage.process
- FusionClusterer.cluster
- AssociationEngine.associate
- KalmanFilterCv2d.predict
- KalmanFilterCv2d.updateWithDebug
- TrackingHealthPublisher.maybePublish
- trackingDebugFormat.* (debug only)

FusionClusterer calls:

- TransformService.toLocalMm

No other cross-module dependencies are allowed.

---

# 5) Config Ownership (Reference)

This section documents which module reads which config keys.

### TrackingPipeline
- tracking.mode
- tracking.updateIntervalMs
- tracking.maxDtMs
- tracking.dropTimeoutMs
- tracking.association.*
- tracking.handover.*

### RadarSnapshotBuffer
- tracking.snapshot.*
- tracking.health.recvLagHugeMs
- tracking.health.slotCountMax

### TrackingObservationStage
- tracking.kf.measNoiseBaseMm
- quality.*

### FusionClusterer
- tracking.fusion.*
- layout.radarFovDeg
- quality.edgeBearingCutoffDeg
- quality.rangeCutoffMm

### AssociationEngine
- tracking.association.gateD2Max

### KalmanFilterCv2d
- tracking.kf.*

### TrackingHealthPublisher
- tracking.health.*

---

# 6) Terminology

Inside tracking:

- **measurement** = raw world point from ingest
- **observation** = processed measurement used by KF
- **track** = persistent state estimate

TrackingPipeline owns lifecycle.
Other modules are stateless processors or math engines.

---

End of file.
