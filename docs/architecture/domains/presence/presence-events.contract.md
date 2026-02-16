<!-- docs/architecture/domains/presence/presence-events.contract.md -->
# Presence Domain — Event Contracts (v1)

This document freezes v1 Presence domain event contracts.

Raw device event schemas are defined elsewhere.
This file covers Presence domain events on `presenceInternalBus` and `mainBus`.

---

# presenceInternalBus

---

## presence:ld2450Tracks

Per-radar transformed tracks from LD2450 ingest.

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
        trackId: 'LD2450B:1',
        state: 'confirmed',
        radarId: 1,
        zoneId: 'zone1',
        local: { xMm: -15, yMm: 2050, rangeMm: 2050, bearingDeg: -0.42 },
        world: { xMm: -2050, yMm: 40, rangeMm: 2050.39, bearingDeg: 178.88 },
        vxMmS: 0,
        vyMmS: 0,
        speedMmS: 0,
        ageMs: 0,
        lastSeenMs: 0,
        sourceRadars: [1],
        provenance: {
          publishAs: 'LD2450B',
          radarId: 1,
          slotId: 1,
          measTs: 1770238439564
        }
      }
    ],

    meta: {
      slotCount: 3,
      detectionCount: 1,
      frame: 'radarLocal_to_world_v0'
    },

    // optional when debug.enabled=true
    debug: { /* ingest timing/frame debug */ }
  }
}
```

---

## presence:ld2410Stable

Debounced LD2410 stable state.

Producer:
- Ld2410IngestAdapter

```js
{
  type: 'presence:ld2410Stable',
  ts: 1770238439564,
  payload: {
    zoneId: 'front',
    present: true,
    publishAs: 'LD2410A'
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
    publishAs: 'presenceController.trackingPipeline',

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
        lastMeasAgeMs: 42,
        lastRadarId: 1,
        lastZoneId: 'zone1',
        sourceRadars: [0, 1]
      }
    ],

    meta: {
      activeTracks: 1,
      tickIntervalMs: 50,
      snapshotKey: '0:1770238439500|1:1770238439560',
      snapshotChangedThisTick: true
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

- `overall` snapshot/tick lag/degraded summary
- `radars` per-radar status
- `meas` stage counts
- `fusion` stats
- `sanity` error/warn/degraded lists

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
        vxMmS: 15.41,
        vyMmS: -11.45,
        speedMmS: 19.2,
        ageMs: 511738,
        lastSeenMs: 86,
        sourceRadars: [0, 1]
      }
    ],

    // optional (when global meta is present)
    meta: { activeTracks: 1, tickIntervalMs: 50 },

    // optional periodic summary derived from meta
    health: { ts: 1770223715168, radarsFresh: 2, activeTracks: 1 }
  }
}
```

Only semantic outputs are published here.

Notes:
- Presence domain currently does not publish `presence:enter` / `presence:exit`.
- `presence:targets` includes confirmed tracks only.

---

# Versioning

This defines Presence v1 contracts.

Breaking changes require version bump.

---
