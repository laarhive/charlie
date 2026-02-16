<!-- docs/architecture/domains/presence/presence-domain.impl.md -->
# Presence Domain — Implementation Reference (current)

This document reflects what exists in the repository today.

It describes:
- Directory layout
- Bus ownership
- Module responsibilities
- Current wiring

This is the maintenance reference.

---

# Directory Layout (current)

```
src/domains/presence/
  ingest/
    ld2450IngestAdapter.js

  transform/
    transformService.js

  tracking/
    trackingPipeline.js
    associationEngine.js
    kalmanFilterCv2d.js

    snapshot/
      radarSnapshotBuffer.js

    observation/
      trackingObservationStage.js

    fusion/
      fusionClusterer.js

    debug/
      trackingHealthPublisher.js
      trackingDebugFormat.js

  presenceController.js
```

LD2410 ingest exists but is not part of v1 core flow.

---

# Bus Ownership

## presenceBus (raw ingress)

Producers:
- LD2450 devices

Events:
- `presenceRaw:ld2450`

Only raw device data appears here.

---

## presenceInternalBus (derived domain state)

Producers:
- Ld2450IngestAdapter
- TrackingPipeline
- TrackingHealthPublisher

Events:
- `presence:ld2450Tracks`
- `presence:globalTracks`
- `presence:trackingSnapshotHealth`

This bus is domain-internal only.

---

## mainBus (semantic output)

Producer:
- PresenceController

Events:
- `presence:targets`

Only semantic outputs go here.

---

# Core Components

## 1) PresenceController

- Subscribes to presenceBus
- Wires ingest adapters
- Instantiates tracking pipeline
- Republishes globalTracks to mainBus as presence:targets

It is the only component publishing to mainBus.

---

## 2) Ld2450IngestAdapter

Responsibilities:

- Validate raw frames
- Map publishAs → radarId
- Transform local → world
- Emit presence:ld2450Tracks

Emits one internal event per radar frame (even if empty).

---

## 3) TransformService

- Converts radar-local → world
- Applies yaw offsets
- Defines coordinate conventions

---

## 4) TrackingPipeline (orchestrator)

Owns:

1) RadarSnapshotBuffer
2) TrackingObservationStage
3) FusionClusterer
4) AssociationEngine
5) KalmanFilterCv2d
6) Track lifecycle
7) TrackingHealthPublisher

Tick flow:

1) Build snapshot (temporal alignment)
2) Observation stage (filter + quality scaling)
3) Fusion clustering
4) Predict tracks
5) Associate
6) Update
7) Spawn new tracks
8) Drop stale tracks
9) Publish globalTracks

---

## Snapshot Stage

File: snapshot/radarSnapshotBuffer.js

Responsibilities:

- Per-radar buffering
- Monotonic measTs clamp
- Temporal alignment
- TTL cleanup
- Snapshot meta

---

## Observation Stage

File: observation/trackingObservationStage.js

Responsibilities:

- Bearing & range filtering
- Dedup
- Jitter scaling
- Stale scaling
- Jump scaling
- Produce measVarMm2ByIdx

---

## Fusion Stage

File: fusion/fusionClusterer.js

Responsibilities:

- Cluster nearby measurements
- Visibility gating
- Weighted centroid
- Fused variance

---

## Association

File: associationEngine.js

- Gated nearest-neighbor
- Returns assignments + unassigned

---

## KF

File: kalmanFilterCv2d.js

- Constant velocity model
- Predict / update

---

## Health Publisher

File: debug/trackingHealthPublisher.js

Publishes:

- Tick lag stats
- Snapshot stats
- Sanity counters
- Degraded state

Event:
- presence:trackingSnapshotHealth

---

# Current Behavior Notes

- Multiple real targets are expected if radars see reflections.
- ID swaps are possible under ambiguity.
- Tracking is authoritative for coordinates.
- Main bus contains only semantic target snapshots.

---

End of implementation reference.
