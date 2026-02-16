<!-- docs/architecture/domains/presence/README.md -->
# Presence Domain — Architecture Index

This is the entry point for all Presence domain documentation.

The Presence domain is split into four primary documents:

1. **Specification (requirements + high-level design)**
2. **Event contracts (frozen schemas)**
3. **Implementation reference (current wiring)**
4. **Tracking modules (internal responsibilities + APIs)**

Use this file as the navigation index.

---

# 1) System Specification (Authoritative Requirements)

**File:**  
`presence-tracking-calibration.spec.md`

**Purpose:**  
Defines the system requirements and high-level design.

Contains:
- Multi-radar tracking requirements
- Presence policy rules
- Calibration architecture
- Geometry and coordinate conventions
- Configuration defaults
- Explicit non-goals
- Optional LD2410 appendix
- Future radar extensibility notes

This is the source of truth for:
- What the system must do
- What is in/out of scope
- Policy-level behavior

---

# 2) Event Contracts (Frozen v1)

**File:**  
`presence-events.contract.md`

**Purpose:**  
Defines bus boundaries and event schemas.

Contains:
- Bus ownership rules
- Raw vs internal vs semantic bus separation
- Frozen v1 schemas for:
  - `presence:ld2450Tracks`
  - `presence:globalTracks`
  - `presence:targets`
  - Zone events
- Coordinate conventions
- Versioning policy

This is the source of truth for:
- Event names
- Payload shapes
- What is allowed on which bus
- Backwards compatibility constraints

---

# 3) Implementation Reference (Current Repo State)

**File:**  
`presence-domain.impl.md`

**Purpose:**  
Documents how the code is currently wired.

Contains:
- Directory layout
- Bus usage
- Component ownership
- Example payloads
- Current config touchpoints
- Known behaviors / gotchas
- Implementation roadmap

This reflects:
- What exists today
- How components are instantiated
- What publishes/subscribes where

This document may change as the implementation evolves.

---

# 4) Tracking Modules (Responsibilities + APIs)

**File:**  
`../../presence/tracking-modules.md`

(Relative path from this folder:
`docs/architecture/presence/tracking-modules.md`)

**Purpose:**  
Developer-level documentation for the tracking subsystem.

Contains:
- Data flow graph
- Internal measurement and track shapes
- Per-file responsibilities
- Public APIs per class
- Config ownership per module
- Integration boundaries
- Allowed cross-module calls

This is the reference for:
- Refactoring tracking safely
- Keeping responsibilities clean
- Avoiding hidden coupling

---

# Recommended Reading Order

For new contributors:

1. `presence-tracking-calibration.spec.md`
2. `presence-events.contract.md`
3. `presence-domain.impl.md`
4. `tracking-modules.md`

For refactoring tracking only:

1. `tracking-modules.md`
2. `presence-events.contract.md`

For modifying presence policy or calibration:

1. `presence-tracking-calibration.spec.md`

---

# Document Roles Summary

| Document | Stable? | Owns What |
|----------|---------|-----------|
| spec | High | Requirements + design constraints |
| event contracts | Very high | Bus + payload schemas |
| implementation | Medium | Current wiring |
| tracking modules | High | Internal tracking APIs |

---
