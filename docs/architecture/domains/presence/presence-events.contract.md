<!-- docs/architecture/domains/presence/presence-events.contract.md -->
# Presence Domain — Architecture & Event Contracts (v1)

This document defines the **Presence domain architecture**, internal buses, and the **v1 frozen event contracts** for tracking and presence outputs.  
It is intended as a long-term reference, similar in role to `led-output.spec.md`.

---

## Goals

- Strict separation of concerns
- Tracking works independently of calibration
- Calibration feeds back **only extrinsics**, never blocks tracking
- Raw sensor data is never mixed with semantic presence events
- Clear bus ownership and event naming
- Debug/UI access to final coordinates without polluting semantic logic

Non-goals:
- UI design
- Device protocol details
- Perfect identity continuity

---

## Buses

### 1. Presence Bus (raw input only)
**Purpose:** Device → domain ingress  
**Producers:** LD2450, LD2410 devices  
**Consumers:** Presence ingest adapters

Events:
- `presenceRaw:ld2450`
- `presenceRaw:ld2410`

No derived or semantic events are published here.

---

### 2. Presence Internal Bus (derived state)
**Purpose:** Internal fan-out of normalized / derived data  
**Visibility:** Presence domain only (not consumed by app logic directly)

Events:
- `presence:ld2450Tracks`
- `presence:ld2410Stable`
- (optional debug/status)
  - `presence:calibrationStatus`
  - `presence:zonesState`

---

### 3. Main Bus (semantic output)
**Purpose:** App-level semantics, automation, UI, LEDs  
**Producers:** Presence controller (final stage only)

Events:
- `presence:targets`
- `presence:enter`
- `presence:exit`

---

## High-Level Architecture

```
┌──────────────────────────┐
│        LD2450 Device     │
│        LD2410 Device     │
└───────────┬──────────────┘
            │
            ▼
     Presence Bus (raw)
     ──────────────────
     presenceRaw:ld2450
     presenceRaw:ld2410
            │
            ▼
┌──────────────────────────┐
│   Ingest Adapters        │
│  - normalize units       │
│  - map publishAs → ids   │
└───────────┬──────────────┘
            │
            ▼
 Presence Internal Bus (derived)
 ─────────────────────────────
 presence:ld2450Tracks
 presence:ld2410Stable
            │
            │──────────────┐
            │              │
            ▼              ▼
┌─────────────────┐   ┌────────────────────┐
│ Tracking        │   │ Calibration         │
│ Pipeline        │   │ Pipeline            │
│ (KF + assoc)    │   │ (sessions + solver) │
└────────┬────────┘   └─────────┬──────────┘
         │                      │
         │          updates yaw │
         │          offsets     │
         │                      ▼
         │               ┌──────────────┐
         │               │ Extrinsics / │
         │               │ Transform    │
         │               │ Service      │
         │               └──────────────┘
         │
         ▼
┌──────────────────────────┐
│ Zone Presence Engine     │
│ (policy + hysteresis)   │
└───────────┬──────────────┘
            │
            ▼
        Main Bus (semantic)
        ──────────────────
        presence:targets
        presence:enter
        presence:exit
```

---

## Coordinate & Layout Conventions

Defined in `config/controllers/presence.json5`.

```json5
// Azimuth convention:
// - degrees clockwise from North
// - 0° = North (radar 0 forward)
// - 90° = East (right)
// - 180° = South (back)
// - 270° = West (left)
radarAzimuthDeg: [0, 90, 180, 270]
```

World frame:
- +X = North
- +Y = East

---

## Event Contracts (Frozen v1)

### presence-internal: `presence:ld2450Tracks`

**Authoritative output of LD2450 tracking pipeline**

- **Bus:** Presence Internal Bus
- **Producer:** Tracking pipeline
- **Consumers:** Calibration, zone engine, main-bus publisher, debug UI

```js
{
  type: 'presence:ld2450Tracks',
  ts: 1770197071450,        // publish time (ms)

  payload: {
    ts: 1770197071400,      // tracking tick / measurement-aligned time

    tracks: [
      {
        trackId: 't17',
        state: 'confirmed', // 'tentative' | 'confirmed' | 'predicted'

        // World position (mm)
        xMm: 1234,
        yMm: 2506,

        // World velocity (mm/s)
        vxMmS: 10,
        vyMmS: -35,

        // Derived
        rangeMm: 2795,
        bearingDeg: 62.3,    // clockwise from North
        speedMmS: 36.4,

        // Lifecycle / diagnostics
        ageMs: 1840,
        lastSeenMs: 120,
        sourceRadars: [0, 1]
      }
    ]
  }
}
```

Notes:
- `trackId` is global and best-effort stable.
- Local LD2450 target IDs are **not** propagated.
- Empty `tracks[]` is valid and meaningful.

---

### presence-internal: `presence:ld2410Stable`

**Debounced LD2410 presence state**

```js
{
  type: 'presence:ld2410Stable',
  ts: 1770197071500,

  payload: {
    zoneId: 'zone0',
    present: true
  }
}
```

LD2410 **never** emits enter/exit events.

---

### main bus: `presence:targets`

**Semantic, UI-ready target snapshot**

- Derived from `presence:ld2450Tracks`
- Emitted only after tracking pipeline completes

```js
{
  type: 'presence:targets',
  ts: 1770197071450,

  payload: {
    targets: [
      {
        id: 't17',
        xMm: 1234,
        yMm: 2506,
        rangeMm: 2795,
        bearingDeg: 62.3,
        speedMmS: 36.4,

        zoneId: 'zone0' // optional convenience
      }
    ]
  }
}
```

This event is what LED modulators, UI, and automation should consume.

---

### main bus: Zone presence

```js
presence:enter  { zoneId }
presence:exit   { zoneId }
```

Emitted **only** by the Zone Presence Engine.

---

## Policy Rules Summary

- Raw frames are never dropped, even when no targets are present.
- LD2450 `valid:false` slots mean “empty slot”, not invalid data.
- Tracking is authoritative for coordinates.
- LD2410 is auxiliary and gates presence **only via policy**.
- Calibration never blocks tracking; it only updates extrinsics.
- Main bus contains **semantic facts only**, not intermediate state.

---

## Versioning

- This document defines **Presence v1 contracts**.
- Any breaking change requires bumping this spec and event versioning.

---

End of document.
