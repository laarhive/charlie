# Presence Domain — Phase 2 (Layout + Extrinsics)

## Goal
1) Attach `radarId` + `zoneId` metadata to LD2450 detections.
2) Convert radar-local `(xMm,yMm)` into **world** `(Xmm,Ymm)` using:
  - tube radius offset
  - radar azimuths
  - yaw offsets (δ) from config/persistence (currently defaults)

This keeps the system runnable while we incrementally add tracking + zones.

---

## Event flow (unchanged buses)

```
presence bus (raw)
  presenceRaw:ld2450
  presenceRaw:ld2410
        ↓
Ingest Adapters
  - Ld2450IngestAdapter  → presenceInternal: presence:ld2450Tracks
  - Ld2410IngestAdapter  → presenceInternal: presence:ld2410Stable
        ↓
PresenceController (orchestrator)
  - forwards derived targets to main bus (presence:targets)
        ↓
main bus (semantic)
  presence:targets        (UI, LED rules)
  presence:enter/exit     (later)
```

---

## Config used in this phase

### layout.ld2450 (explicit enable + radarId by index)
`radarId` is the index into `layout.ld2450[]` and corresponds to `layout.radarAzimuthDeg[radarId]`.

### extrinsics
`extrinsics.yawOffsetsDeg`:
- `null` => later loaded from persistence
- array length N => explicit overrides
- δ0 fixed to 0 by spec

---

## Track shape (presenceInternal: presence:ld2450Tracks)
For each emitted track we add:

- `radarId`
- `zoneId` (default: `zone${radarId}`)
- `local`: `{ xMm, yMm, rangeMm, bearingDeg }`
- `world`: `{ xMm, yMm, rangeMm, bearingDeg }` (computed via TransformService)

Main bus `presence:targets` will use **world** coordinates.

---

# Code changes
- Update `Ld2450IngestAdapter` to:
  - enforce device usable AND layout entry enabled
  - compute radarId from layout order
  - compute world coords via `TransformService`
- Add `TransformService` module
- Small update in PresenceController to prefer world coords

