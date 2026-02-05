<!-- docs/architecture/domains/presence/presence-domain.impl.md -->
# Presence Domain — Implementation Reference (current)

This is the *maintenance* doc for the Presence domain: what exists in the repo today, how it’s wired, what each component owns, and what’s next.

Keep it short: examples > prose.

---

## Directory layout (current)

```
src/domains/presence/
  ingest/
    ld2450IngestAdapter.js
    ld2410IngestAdapter.js
  tracking/
    associationEngine.js
    kalmanFilterCv2d.js
    trackingPipeline.js
  transform/
    transformService.js
  presenceController.js
```

---

## Buses and ownership

### `buses.presence` (raw sensor domain)
**Producers:** LD2450 devices, LD2410 devices  
**Consumers:** `PresenceController` (via ingest adapters)

Raw events only:
- `presenceRaw:ld2450`
- `presenceRaw:ld2410`

### `buses.presenceInternal` (derived / domain-internal)
**Producers:** Presence domain components  
**Consumers:** Presence domain + debug UI

Derived events (current):
- `presence:ld2450Tracks` (per-radar, transformed to world)
- `presence:globalTracks` (global tracking output)

Optional later:
- `presence:ld2410Stable`
- `presence:zonesState`
- `presence:calibrationStatus`

### `buses.main` (semantic outputs)
**Producer:** `PresenceController`  
**Consumers:** app, UI, LED rules, automations

Semantic event (current):
- `presence:targets`

---

## Event types (current)

From `src/domains/domainEventTypes.js` (presence subset):

```js
presenceRaw:ld2450
presenceRaw:ld2410

presence:ld2450Tracks
presence:ld2410Stable
presence:calibrationStatus

presence:globalTracks   // currently emitted by TrackingPipeline
```

Main bus:
- `presence:targets` (from `src/core/eventTypes.js`)

---

## Components (what they do)

### 1) `PresenceController` (domain orchestrator)
**File:** `src/domains/presence/presenceController.js`  
**Role:** The only piece that subscribes to `presenceBus` and publishes to `mainBus`. It wires:
- LD2450 ingest → `presenceInternal:presence:ld2450Tracks`
- Tracking pipeline → `presenceInternal:presence:globalTracks`
- Main output → `main:presence:targets` (from global tracks)

**Constructor wiring (current pattern):**
- `presenceBus` is **read-only** (subscribe)
- `presenceInternalBus` is **write/read** (publish + subscribe by internal modules)
- `mainBus` is **write-only** (publish)

---

### 2) Ingest adapters (raw → normalized)
#### 2.1 `Ld2450IngestAdapter`
**File:** `src/domains/presence/ingest/ld2450IngestAdapter.js`  
**Role:**
- validates the raw LD2450 frame
- resolves `publishAs` → `radarId` using `config.layout.ld2450[]`
- ignores sensors that are `enabled:false` or `degraded:true`
- transforms radar-local → world via `TransformService`
- emits **one** internal event per raw frame

**Internal output:**
- `presenceInternalBus.publish({ type: 'presence:ld2450Tracks', ... })`

**Example (internal):**
```js
// presenceInternal: presence:ld2450Tracks
{
  type: 'presence:ld2450Tracks',
  ts: 1770238439564,
  payload: {
    ts: 1770238439564, // frame timestamp from sensor if available
    tracks: [
      {
        trackId: 'LD2450B:1',         // publishAs + local slot id (debug identity, not global)
        state: 'confirmed',
        radarId: 1,
        zoneId: 'zone1',

        local: { xMm: -15, yMm: 2050, rangeMm: 2050.05, bearingDeg: -0.42 },

        // world frame (+X North, +Y East)
        world: { xMm: -2050, yMm: 40, rangeMm: 2050.39, bearingDeg: 178.88 },

        vxMmS: 0,
        vyMmS: 0,
        speedMmS: 0,

        ageMs: 0,
        lastSeenMs: 0,
        sourceRadars: [1]
      }
    ],
    meta: {
      publishAs: 'LD2450B',
      radarId: 1,
      zoneId: 'zone1',
      slotCount: 3,
      detectionCount: 1,
      frame: 'radarLocal_to_world_v0'
    }
  }
}
```

Notes:
- `tracks[]` can be empty and is still a valid “frame”.
- These are **per-radar detections**, not global tracks.

#### 2.2 `Ld2410IngestAdapter` (optional)
**File:** `src/domains/presence/ingest/ld2410IngestAdapter.js`  
**Role (intended):**
- maps `publishAs` → zone (`config.layout.ld2410[]`)
- ignores sensors `enabled:false` or `degraded:true`
- debounces presence → emits stable state

**Internal output (intended):**
- `presence:ld2410Stable` `{ zoneId, present }`

**Example (internal):**
```js
// presenceInternal: presence:ld2410Stable
{
  type: 'presence:ld2410Stable',
  ts: 1770239000100,
  payload: { zoneId: 'zone0', present: true }
}
```

---

### 3) `TransformService` (layout + extrinsics)
**File:** `src/domains/presence/transform/transformService.js`  
**Role:** Converts radar-local (LD2450 coordinates) into a global “Charlie world” frame.

**World convention (current):**
- +X = North / “front” of radar 0 (up on the debug canvas)
- +Y = East / “right” (right on canvas)
- bearings are clockwise from +X (North)

**Current model:**
- radars sit on a tube circle (`tubeDiameterMm`/2)
- each radar has nominal azimuth `phiDeg` from `layout.radarAzimuthDeg[]`
- per-radar yaw offsets `deltaDeg` (extrinsics), with `delta[0] = 0`

Transform:
```
world = R(phi + delta) * local + tubeTranslation(phi)
```

---

### 4) Tracking (global track estimation)
#### 4.1 `TrackingPipeline`
**File:** `src/domains/presence/tracking/trackingPipeline.js`  
**Role:**
- subscribes to `presenceInternal:presence:ld2450Tracks`
- extracts **world** measurements (xMm,yMm) into a buffer
- runs a periodic tick (interval derived from config) to:
  - predict tracks forward (CV model)
  - associate buffered measurements to tracks (gated)
  - update assigned tracks with KF
  - spawn new tracks from unassigned measurements (confirm gate + spawn gate)
  - prune stale tracks
- publishes global snapshot to `presenceInternal:presence:globalTracks`

**Internal output:**
```js
// presenceInternal: presence:globalTracks
{
  type: 'presence:globalTracks',
  ts: 1770238439561,
  payload: {
    ts: 1770238439561,
    tracks: [
      {
        id: 't1770237927823:6',
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
    meta: { bufferedMeas: 2, activeTracks: 1, updateIntervalMs: 100 }
  }
}
```

#### 4.2 `AssociationEngine`
**File:** `src/domains/presence/tracking/associationEngine.js`  
**Role:** Nearest-neighbor assignment with gating. Uses `gateD2Max`.

#### 4.3 `KalmanFilterCv2d`
**File:** `src/domains/presence/tracking/kalmanFilterCv2d.js`  
**Role:** Constant-velocity KF for `[x, y, vx, vy]`.

---

## Main bus output (what the rest of the app uses)

### `main:presence:targets`
**Producer:** `PresenceController`  
**Source:** current global tracks

Example:
```js
// main: presence:targets
{
  type: 'presence:targets',
  ts: 1770223715168,
  payload: {
    targets: [
      {
        id: 't1770223708924:0',
        xMm: -2385.06,
        yMm: -849.98,
        vxMmS: -4.06,
        vyMmS: 29.09,
        speedMmS: 29.37,
        ageMs: 6244,
        lastSeenMs: 25,
        sourceRadars: [1]
      }
    ]
  }
}
```

Notes:
- No local coordinates on main bus (debug stays on `presence` / `presenceInternal`).

---

## Current config touchpoints (what code reads)

From `config/controllers/presence.json5` (subset used now / soon):

- `enabled`
- `layout.radarAzimuthDeg[]`
- `layout.ld2450[]` with `{ publishAs, enabled, degraded? }`
- `layout.ld2410[]` with `{ publishAs, enabled, zoneId, degraded? }`
- `tracking.*` (tick interval, KF params, association gates, confirm gates)
- `extrinsics.yawOffsetsDeg` (optional override)

---

## Wiring summary (who subscribes to what)

- `PresenceController`
  - subscribes: `presenceBus` (raw)
  - publishes: `presenceInternalBus` (derived) and `mainBus` (semantic)
  - owns: adapter instances + pipeline instances

- `Ld2450IngestAdapter`
  - called by controller per raw event
  - publishes: `presence:ld2450Tracks` on `presenceInternalBus`

- `TrackingPipeline`
  - subscribes: `presenceInternalBus` (`presence:ld2450Tracks`)
  - publishes: `presence:globalTracks` on `presenceInternalBus`

---

## Known current behaviors / gotchas (as seen in logs)

- If radars “see behind” (no backshield), you will get multiple real detections → multiple global tracks. This is not necessarily a software duplicate.
- If association gates are too strict or spawn gate too permissive, you can also get duplicates (spawn new track instead of attaching).

---

## Next steps (implementation plan)

1) **LD2410 stable path**
  - finish `Ld2410IngestAdapter` to emit `presence:ld2410Stable`
  - confirm it is visible on `presenceInternal`

2) **Zone presence engine**
  - consume `globalTracks` + `ld2410Stable`
  - publish `main:presence:enter/exit` (or zone snapshot) using the policy in the spec

3) **Calibration (yaw offsets)**
  - implement conservative sessions (overlap-only)
  - update `TransformService` yaw offsets live (and persistence later)

4) **Debug UI**
  - show:
    - raw detections (presence bus) transformed in browser (optional)
    - internal per-radar transformed tracks (`presence:ld2450Tracks`)
    - global tracks (`presence:globalTracks`)
    - zone states

---

## Relationship to the existing spec docs

- Keep the long design doc as the *scope/spec*:
  - `docs/architecture/domains/presence/presence-tracking-calibration.spec.md`
- Use this file as the *implementation reference* (what exists today and wiring):
  - `docs/architecture/domains/presence/presence-domain.impl.md`
