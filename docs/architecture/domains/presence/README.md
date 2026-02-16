<!-- docs/architecture/domains/presence/README.md -->
# Presence Domain — Architecture Index

Entry point for Presence domain docs.

The Presence docs are split into four documents:

1. Specification (requirements + high-level design)
2. Event contracts (frozen v1 schemas)
3. Implementation reference (current wiring)
4. Tracking modules (internal responsibilities + APIs)

---

# 1) System Specification (Authoritative Requirements)

**File:**  
`presence-tracking-calibration.spec.md`

**Purpose:**  
Defines required behavior and high-level design.

Contains:
- Multi-radar tracking requirements
- Presence policy requirements
- Calibration architecture and constraints
- Geometry conventions
- Optional LD2410 appendix

Status note (current implementation):
- Calibration is not implemented yet.
- Zone enter/exit policy engine is not implemented in the Presence domain yet.

---

# 2) Event Contracts (Frozen v1)

**File:**  
`presence-events.contract.md`

**Purpose:**  
Defines Presence event names, bus boundaries, and payload schemas.

Contains frozen v1 schemas for:
- `presence:ld2450Tracks`
- `presence:ld2410Stable`
- `presence:globalTracks`
- `presence:trackingSnapshotHealth`
- `presence:targets`

---

# 3) Implementation Reference (Current Repo State)

**File:**  
`presence-domain.impl.md`

**Purpose:**  
Documents what is currently wired in code.

Contains:
- Directory layout
- Bus usage
- Component ownership
- Current behavior notes

---

# 4) Tracking Modules (Responsibilities + APIs)

**File:**  
`tracking-modules.md`

**Purpose:**  
Developer reference for tracking internals.

Contains:
- Data flow
- Internal observation/track shapes
- Per-file responsibilities
- Public APIs
- Config ownership
- Integration boundaries

---

# Recommended Reading Order

For new contributors:

1. `presence-tracking-calibration.spec.md`
2. `presence-events.contract.md`
3. `presence-domain.impl.md`
4. `tracking-modules.md`

For tracking-only refactors:

1. `tracking-modules.md`
2. `presence-events.contract.md`
