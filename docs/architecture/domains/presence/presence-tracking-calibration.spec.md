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

Implementation status (as of 2026-02-16):
- Multi-radar LD2450 tracking is implemented.
- Calibration workflow is not implemented yet.
- Zone enter/exit policy engine is not implemented in the Presence domain yet.

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

# Appendix B — Presence v1 Acceptance Test Plan

This section defines the **minimum acceptance criteria** for declaring:

- Global tracking “good enough”
- Zone presence stable
- Calibration usable
- Engagement-compatible

These tests prioritize **presence correctness and stability** over identity continuity.

---

# B.1 Tracking Acceptance Tests

## B.1.1 Static Stability Test

**Setup**
- 1 person stands still at 1.5–3.0 m for 10 seconds.
- Single radar.

**Pass Criteria**
- Position jitter (P95) ≤ **150 mm**
- Velocity magnitude (P95) ≤ **0.25 m/s**
- No more than **1 track reset** during the 10 s window

**Metrics to log**
- `track_jitter_mm_p95`
- `velocity_p95`
- `track_recreate_count`

---

## B.1.2 Smooth Walking Test

**Setup**
- 1 person walks straight across FOV at normal walking speed.

**Pass Criteria**
- Speed estimate mostly in range **0.5–2.0 m/s**
- No more than **2 sign flips** in radial velocity
- Track not lost for >0.5 s

**Metrics**
- `speed_estimate_series`
- `radial_sign_flip_count`
- `track_gap_ms_max`

---

## B.1.3 Stop-and-Go Test

**Setup**
- Person approaches, stops 2 s, then walks away.

**Pass Criteria**
- Stop detected (speed <0.3 m/s) within **≤500 ms**
- No position jump >0.6 m during stop

**Metrics**
- `stop_detection_latency_ms`
- `max_position_delta_mm`

---

# B.2 Multi-Radar Global Tracking

## B.2.1 Overlap Transform Sanity

**Setup**
- Single person visible to 2 radars in overlap region.

**Pass Criteria**
- Cross-radar global position mismatch ≤ **800 mm pre-calibration**
- No axis inversion (left/right consistency)

**Metrics**
- `overlap_position_error_mm_mean`
- `overlap_position_error_mm_p95`

---

## B.2.2 Dominant Track Stability

**Setup**
- Single person in overlap for 10 s.

**Pass Criteria**
- One dominant global track for ≥70% of the time
- Temporary duplicate tracks allowed
- Convergence back to single dominant track within ≤1.0 s

**Metrics**
- `dominant_track_ratio`
- `duplicate_track_duration_ms_max`

---

## B.2.3 Two-Person Crossing Stress Test

**Setup**
- 2 people cross paths in overlap region.

**Pass Criteria**
- Zone presence remains correct
- No persistent track explosion (>3 tracks for >1.0 s)
- Identity swaps allowed

**Metrics**
- `track_count_max`
- `track_explosion_duration_ms`

---

# B.3 Zone Presence Policy Engine

## B.3.1 Enter Confirm Test

**Setup**
- Person enters zone briefly (200–400 ms) then exits.

**Pass Criteria**
- Zone does NOT enter present state if confirm timer > dwell time

**Metrics**
- `zone_enter_attempts`
- `zone_false_enter_count`

---

## B.3.2 Hold Against Brief Radar Loss

**Setup**
- Person stands in zone; radar drops for 300–500 ms.

**Pass Criteria**
- Zone remains present
- No flicker events

**Metrics**
- `zone_flicker_count`
- `radar_loss_duration_ms`

---

## B.3.3 Clear Behavior Test

**Setup**
- Person leaves zone.

**Pass Criteria**
- Zone clears within configured clear delay ± one tick
- Clear does not depend on track ID stability

**Metrics**
- `zone_clear_latency_ms`
- `zone_stuck_count`

---

# B.4 Calibration Workflow

## B.4.1 No-Overlap Session

**Setup**
- Calibration started with no radar overlap.

**Pass Criteria**
- No extrinsics updated
- Tracking continues uninterrupted

**Metrics**
- `calibration_solution_found = false`
- `tracking_interruption_count = 0`

---

## B.4.2 Static Overlap Rejection

**Setup**
- Calibration session with stationary person only.

**Pass Criteria**
- Session rejected or marked low confidence
- No deltas persisted

**Metrics**
- `calibration_confidence_score`
- `extrinsics_updated = false`

---

## B.4.3 Single Walker Convergence

**Setup**
- Single person walks through overlap for 20–30 s.

**Pass Criteria**
- Yaw deltas converge within ±3°
- Mean cross-radar position error reduced ≥30–50% after applying deltas

**Metrics**
- `delta_yaw_estimate_deg`
- `overlap_error_before_mm_mean`
- `overlap_error_after_mm_mean`

---

## B.4.4 Ambiguity Rejection

**Setup**
- Two people present during calibration session.

**Pass Criteria**
- Session rejected or flagged low confidence
- No extrinsics persisted

**Metrics**
- `calibration_confidence_score`
- `extrinsics_updated = false`

---

## B.4.5 Persistence Test

**Setup**
- Run calibration, persist extrinsics, restart system.

**Pass Criteria**
- Extrinsics loaded correctly
- Overlap error consistent with pre-restart values

**Metrics**
- `extrinsics_load_success`
- `overlap_error_post_restart_mm_mean`

---

# B.5 Engagement Compatibility Tests

## B.5.1 Single Active Target Lock

**Setup**
- One person triggers engagement and transitions across radar sectors.

**Pass Criteria**
- No duplicate START events
- Engagement persists through sector transition (≤1.0 s grace)

**Metrics**
- `conversation_start_count`
- `handoff_count`
- `engagement_drop_count`

---

## B.5.2 No Interruption by Passers

**Setup**
- Engaged person remains near; second passer briefly enters higher-priority sector.

**Pass Criteria**
- Engagement does not switch unless handoff gate matches
- No premature STOP event

**Metrics**
- `engagement_switch_attempts`
- `engagement_switch_blocked_count`

---

# B.6 Default Reliability Gates (Reference)

These values are recommended defaults for v1:

- Track loss grace: **1000–1500 ms**
- Handoff time gate: **≤500 ms**
- Handoff distance gate: **≤1000 mm**
- Speed difference gate: **≤0.8 m/s**
- Suspicious jump threshold: **≥600 mm per tick**

---
