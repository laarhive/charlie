<!-- docs/architecture/domains/presence/presence-events.contract.md -->
# Presence Domain — Event Contracts (v1)

This document freezes the v1 event contracts.

Raw device contracts are defined elsewhere.
This document covers domain-level events only.

---

# presenceInternalBus

---

## presence:ld2450Tracks

Per-radar world-transformed detections.

Producer:
- Ld2450IngestAdapter

```js
{
  type: 'presence:ld2450Tracks',
  ts: 1770238439564,

  payload: {
    radarId: 1,
    publishAs: 'LD2450B',
    zoneId: 'zone1',
    measTs: 1770238439564,

    tracks: [
      {
        xMm: -2050,
        yMm: 40,
        prov: {
          localMm: { xMm: -15, yMm: 2050 },
          slotId: 1
        }
      }
    ],

    meta: {
      slotCount: 3,
      detectionCount: 1
    }
  }
}
```

---

## presence:globalTracks

Global tracking snapshot.

Producer:
- TrackingPipeline

```js
{
  type: 'presence:globalTracks',
  ts: 1770238439561,

  payload: {
    ts: 1770238439561,

    tracks: [
      {
        id: 't123',
        state: 'confirmed',

        xMm: -2046,
        yMm: 39,

        vxMmS: 15.41,
        vyMmS: -11.45,
        speedMmS: 19.2,

        ageMs: 511738,
        lastSeenMs: 86,
        lastRadarId: 1,
        lastZoneId: 'zone1',
        sourceRadars: [0, 1]
      }
    ],

    meta: {
      activeTracks: 1,
      updateIntervalMs: 100
    }
  }
}
```

---

## presence:trackingSnapshotHealth

Published periodically.

Producer:
- TrackingHealthPublisher

Contains:

- snapshot meta
- per-radar status
- tick lag stats
- sanity counters
- fusion stats

Schema intentionally extensible.

---

# mainBus

---

## presence:targets

Semantic target snapshot.

Producer:
- PresenceController

```js
{
  type: 'presence:targets',
  ts: 1770223715168,

  payload: {
    targets: [
      {
        id: 't123',
        xMm: -2046,
        yMm: 39,
        speedMmS: 19.2,
        zoneId: 'zone1'
      }
    ]
  }
}
```

Only semantic data appears here.

---

# Versioning

This defines Presence v1 contracts.

Breaking changes require version bump.

---
