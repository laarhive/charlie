<!-- docs/architecture/domains/presence/presence-tracking-calibration.spec.md -->
# Presence Domain — Tracking & Calibration Specification (v1)

This document defines the **requirements and high-level design** of the Presence domain.

It describes:
- What the system MUST do
- What is optional
- What is out of scope
- Core geometry and calibration principles

Implementation details live in:
- `presence-domain.impl.md`
- `presence-events.contract.md`

---

# 1. Scope and Purpose

## 1.1 Purpose

The Presence domain ingests asynchronous detections from multiple millimeter-wave radars (LD2450) and produces:

1. Robust zone-level presence detection (highest priority)
2. Reliable global multi-target tracking with jitter suppression
3. Conservative, safe inter-radar calibration (lower priority than presence)

Presence correctness always has priority over identity continuity.

---

# 2. Core Sensors (v1)

## 2.1 LD2450 (core sensor)

The system SHALL ingest data from **N LD2450 radars**, where:

```
N = config.layout.ld2450.length (enabled radars)
```

Each radar:
- Reports 0–3 targets per update
- Updates asynchronously (no hardware sync)
- May temporarily miss targets
- May saturate at 3 targets

The system MUST tolerate:
- Missing frames
- Target cap saturation
- Temporary disappearance
- Asynchronous timing

---

## 2.2 Optional Auxiliary Sensors (Future)

Auxiliary presence sensors (e.g. LD2410) MAY be integrated in future versions.

They:
- Are NOT required for operation
- Must not block tracking
- May influence zone presence policy only

See Appendix A.

---

# 3. Outputs

## 3.1 Global Tracking Output

The system SHALL output:

- Global X/Y (mm)
- Global velocity
- Derived range & bearing
- Lifecycle state
- Source radars

Tracks are:
- Global (not owned by any radar)
- Best-effort identity continuity
- Dropped after timeout

---

## 3.2 Zone Presence Output

Presence SHALL:

- Be derived from tracking
- Support static presence
- Use confirm / hold / clear timers
- Tolerate temporary radar loss

Presence is authoritative even if tracking identity changes.

---

# 4. Geometry & Layout

## 4.1 World Frame

- +X = North (Radar 0 forward)
- +Y = East
- Bearings clockwise from +X

## 4.2 Radar Placement

Defined by:

```json5
layout: {
  radarAzimuthDeg: [0, 90, 180, 270],
  tubeDiameterMm: 110
}
```

Transform:

```
world = R(phi + delta) * local + tubeTranslation(phi)
```

Where:
- phi = nominal azimuth
- delta = calibration yaw offset
- delta[0] = 0 (fixed reference)

---

# 5. Tracking Requirements

Tracking SHALL:

- Maintain multiple concurrent global tracks
- Predict forward during temporary loss
- Drop after configurable timeout
- Prioritize smoothness over identity continuity

Identity continuity is best-effort only.

---

# 6. Jitter Suppression

The system SHALL:

- Suppress measurement jitter
- Support variable dt
- Inflate measurement variance based on:
  - Bearing edge
  - Range
  - Jitter
  - Staleness
  - Suspicious jumps

Measurement quality is modular and replaceable.

---

# 7. Calibration Requirements

Calibration SHALL:

- Use LD2450 overlap only
- Operate in discrete sessions
- Be conservative (reject ambiguous data)
- Never block tracking
- Persist extrinsics externally

If no overlap exists, calibration produces no updates.

---

# 8. Explicit Non-Guarantees

The system does NOT guarantee:

- Perfect identity continuity
- Detection of all physical targets
- Calibration availability without overlap
- Hardware-synchronized timing

---

# Appendix A — Optional Auxiliary Presence Sensors

Auxiliary presence sensors (e.g. LD2410) MAY:

- Gate zone enter events
- Prevent premature zone clearing

They MUST:

- Not affect tracking
- Not participate in calibration math
- Not block system operation if absent

Auxiliary presence logic is separate from core tracking.

---
