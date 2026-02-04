# Multi-Radar Global Tracking, Calibration, and Presence Module
## Requirements and High-Level Design

**Target implementation:** Node.js (JavaScript) class/module  
**Core sensors:** LD2450 (tracking), optional LD2410 (presence)  
**Configuration principle:** Radar placement and radar count are defined by `RADAR_AZIMUTH_DEG[]`. `RADAR_AZIMUTH_DEG[0]` MUST be `0` and defines “North”.

---

# 1. Requirements / Scope Agreement

## 1.1 Purpose

The system shall ingest asynchronous detections from multiple millimeter-wave radars and produce real-time global target information.

Responsibilities (ordered by priority):

1. **Robust presence detection, including static presence**  
   (LD2450-based, optionally enhanced by LD2410)

2. **Reliable global tracking with jitter suppression**  
   (LD2450-based, best-effort identity continuity)

3. **Safe, conservative auto-calibration of inter-radar alignment**  
   (LD2450-based, overlap-only, session-based)

Presence correctness and continuity are the highest priority. Calibration correctness and tracking robustness have higher priority than identity continuity.

---

## 1.2 Scope

### In scope
- Ingest data from **N LD2450 radars**, where **N = `RADAR_AZIMUTH_DEG.length`**
- Each LD2450 radar reports **0 to 3 targets per update** (hard sensor cap)
- Track up to **3 × N global targets concurrently** (theoretical maximum from sensor caps)
- Produce real-time global 2D positions and velocities
- Maintain **zone-level presence**, including static presence when motion stops
- Allow presence to remain valid even if individual targets are temporarily lost (e.g., target cap, dropout, handoff)
- Suppress jitter in target motion
- Auto-adjust inter-radar alignment **when overlap exists**
- Persist calibration parameters externally and reload them on startup
- Support optional presence sensors (LD2410), without making them mandatory
- Continue operating correctly with:
  - missing radars (radars not present in configuration are not expected)
  - delayed or asynchronous radar data
  - capped radar outputs
  - ambiguous detections

### Out of scope
- 3D tracking
- Guaranteeing perfect identity continuity
- Inferring targets not reported by radars
- Hardware synchronization between sensors
- Tracking more than 3 targets per radar
- Using optional sensors as a hard dependency

---

## 1.3 Inputs

### 1.3.1 LD2450 (core input)
- The system shall accept input from **N LD2450 radars**, identified by `radarId ∈ [0..N-1]`.
- Each radar update may contain **0–3 detected targets**.
- Radar updates are **asynchronous and unsynchronized**.
- Each target detection includes at minimum:
  - `radarId`
  - local X (lateral) and Y (forward) coordinates
- Optional fields (speed, quality, radar-local target IDs) may be present but shall not be assumed reliable or stable.

### 1.3.2 LD2410 (optional input)
- The system MAY accept input from **0..N LD2410 presence sensors**.
- Each LD2410 sensor is aligned with the orientation of a corresponding LD2450 radar (same zone index by default).
- LD2410 sensors provide **presence/absence** information, including static presence.
- LD2410 input SHALL be treated as **optional** and **auxiliary**.
- The absence, disablement, or malfunction of LD2410 sensors SHALL NOT prevent the system from operating fully.

---

## 1.4 Outputs

### 1.4.1 Presence output (highest priority)
- The system shall output **zone-level presence state** (`occupied = true/false`) for each zone.
- Zone count SHALL be **N by default** (one zone per radar azimuth) unless overridden by configuration.
- Presence output SHALL:
  - remain valid even if individual targets are lost
  - support static presence
  - tolerate radar saturation and temporary target disappearance
- Presence output SHALL function:
  - with LD2450-only input
  - with LD2410 input, according to the rules defined in Section 1.8

### 1.4.2 Global tracking output
- The system shall output **global target states**, including:
  - global X and Y position
  - global velocity (or speed magnitude)
  - derived range and bearing (human-friendly)
- The system may output up to **3 × N global targets** at any time.
- Each output target shall have a **global target identifier**, which:
  - is stable when association is unambiguous and continuously observed
  - may change or be reassigned in ambiguous situations or when observability gaps occur

### 1.4.3 Calibration output
- The system shall output current calibration parameters and their validity status.

---

## 1.5 Tracking requirements
- The system shall maintain **multiple global tracks** concurrently.
- Tracks are global and **not owned by any radar**.
- Tracking SHALL be considered a **supporting signal** for presence detection.
- Tracking shall continue when a target temporarily disappears due to:
  - radar saturation (3-target cap)
  - temporary detection loss
  - movement into a radar that does not report it (for any reason)
- Tracks shall continue in prediction-only mode when unobserved.
- Tracks shall be dropped after a configurable timeout without valid updates.
- The system shall prioritize **position accuracy and smoothness** over identity continuity.
- Identity continuity is **best-effort** and is expected to degrade when:
  - targets are not continuously observable (coverage gaps)
  - associations are ambiguous
  - no overlap exists between radars

---

## 1.6 Jitter suppression
- The system shall suppress measurement jitter in target motion.
- Jitter suppression shall support **variable update intervals**.
- The jitter suppression mechanism shall be **replaceable and modular**.
- Modifying jitter suppression shall not require changes to calibration or presence logic.

---

## 1.7 Calibration requirements (critical but lower priority than presence)
- The system shall improve inter-radar alignment by estimating small yaw offsets.
- Calibration shall:
  - use **only LD2450 overlap data**
  - operate in **discrete calibration sessions**
  - apply **strict quality and safety rules**
- Calibration shall be **strictly conservative**:
  - ambiguous data shall always be discarded
  - skipped calibration is preferable to incorrect calibration
- Calibration SHALL NOT interfere with presence detection.
- LD2410 SHALL NOT be required for calibration and SHALL NOT participate in calibration math.
- LD2410 MAY be used as an **additional eligibility gate** (to disable sampling), but never as a dependency.
- If **no overlapping radar pairs exist**, calibration SHALL be disabled (no updates applied).

---

## 1.8 Presence requirements (LD2410 policy)
### 1.8.1 Optional sensor behavior
- The system SHALL operate fully without LD2410 sensors.
- If LD2410 sensors are present and enabled, the rules below SHALL apply.

### 1.8.2 Entering occupancy (LD2410 present)
When LD2410 is present and enabled for a zone, the zone SHALL enter `occupied = true` **only if both conditions are met**:
1. **LD2450 condition:** At least one LD2450-derived track is detected inside the zone continuously for at least `ZONE_ENTER_CONFIRM_MS`.
2. **LD2410 condition:** The corresponding LD2410 sensor reports presence true (after debouncing).

LD2410 alone SHALL NOT trigger occupancy.

### 1.8.3 Remaining occupied (static presence support)
Once a zone is occupied and LD2410 is present:
- The zone SHALL remain `occupied = true` if **either**:
  - LD2450 reports one or more tracks inside the zone, OR
  - LD2410 reports presence true.

### 1.8.4 Clearing occupancy (LD2410 present)
When LD2410 is present and enabled:
- A zone SHALL clear (`occupied = false`) **only if**:
  - LD2410 reports presence false (after debouncing) for at least `ZONE_CLEAR_CONFIRM_MS`.

If LD2410 does **not** confirm absence, the system SHALL assume the target may be stationary and SHALL keep the zone occupied, even if LD2450 reports no tracks.

### 1.8.5 Fallback when LD2410 is absent
When LD2410 is absent or disabled for a zone:
- Zone occupancy SHALL be derived solely from LD2450 evidence using:
  - `ZONE_ENTER_CONFIRM_MS`
  - `ZONE_HOLD_MS`
  - `ZONE_CLEAR_CONFIRM_MS`

---

## 1.9 Calibration and presence interaction
- Presence detection SHALL NOT be invalidated by calibration state.
- If LD2410 is present and reports absence in a zone:
  - calibration sampling from that zone SHALL be disabled.
- If LD2410 is absent:
  - calibration proceeds using LD2450-only eligibility rules.

---

## 1.10 Calibration persistence
- Calibration parameters shall be stored externally.
- Persisted data shall include:
  - yaw offsets (δ per radar, see HLD)
  - timestamps and quality metadata
- On initialization:
  - persisted calibration shall be loaded and validated
- Invalid or missing calibration SHALL result in safe defaults.

---

## 1.11 Modularity and separation of concerns (mandatory)
- Tracking, association, jitter suppression, calibration, presence logic, and persistence SHALL be **separate modules**.
- Modifying or replacing one algorithm SHALL NOT require changes to others.
- Optional sensor integration SHALL NOT affect core tracking or calibration behavior.
- The system SHALL be developable and testable with LD2450-only input.

---

## 1.12 Timing and synchronization
- The system shall support **asynchronous, unsynchronized sensor inputs**.
- Sensors are not required to share clocks or update simultaneously.
- Variable timing SHALL be handled using timestamped events and prediction.
- No real-time hardware synchronization is required.

---

## 1.13 Explicit non-guarantees
- The system does not guarantee perfect identity continuity.
- The system does not guarantee detection of all physical targets.
- The system does not require LD2410 sensors to function.
- The system does not use ambiguous data for calibration under any circumstance.

---

# 2. High-Level Design

## 2.1 Configuration-driven radar layout
- Radar placement is defined by:
  - `RADAR_AZIMUTH_DEG[]` (degrees)
  - `RADAR_AZIMUTH_DEG[0] MUST equal 0` (defines North)
- Radar count is inferred as:
  - `N = RADAR_AZIMUTH_DEG.length`
- Assumption:
  - `RADAR_FOV_DEG = 120` (applies to LD2450 and LD2410; configurable but default fixed)

---

## 2.2 Architecture (strict separation, swappable algorithms)
(unchanged module list; now parameterized by N)
1) LD2450 Ingest Adapter
2) LD2410 Ingest Adapter (optional)
3) Extrinsics / Transform Service
4) Measurement Quality Policy
5) Association Engine
6) Per-Track State Estimator (KF)
7) Track Lifecycle Manager
8) Zone Presence Engine
9) Calibration Session Manager
10) Calibration Solver + Smoother
11) Persistence Backend

---

## 2.3 Geometry and transforms

### World frame
- Origin: tube center
- +X = North (Radar 0 forward)
- +Y = East (clockwise)

### Tube and per-radar placement
- Tube diameter: 110 mm → `TUBE_RADIUS_MM = 55`
- Radar i nominal azimuth: `φ_i = RADAR_AZIMUTH_DEG[i]`
- Yaw offsets:
  - `δ_0 = 0` fixed
  - solve `δ_i` for i=1..N-1, but **only for radars participating in overlap constraints** (see calibration)

Transform radar-local (x,y) → world (X,Y):
- `t_i = 55 * [cos(φ_i), sin(φ_i)]`
- `θ_i = φ_i + δ_i`
- `z_world = R(θ_i) * [x, y]^T + t_i`

---

## 2.4 Tracking design (LD2450) — priority #2
(unchanged core approach)

### Per-track KF
State `[X, Y, VX, VY]`, variable Δt, constant-velocity model, gating by Mahalanobis distance.

### Association
Default: gated nearest-neighbor assignment.
Identity continuity is best-effort; gaps and non-overlap reduce handoff reliability.

---

## 2.5 Zone presence design — priority #1
Zones are now layout-agnostic.

### Default zone definition (layout-driven)
By default, define one zone per radar i:
- Zone i is an angular sector centered at `φ_i`, spanning the radar’s FOV:
  - `bearing ∈ [φ_i - RADAR_FOV_DEG/2, φ_i + RADAR_FOV_DEG/2]`
- Radius limit: `rho <= R_MAX_MM`

This supports partial coverage (e.g., 270°) naturally.

(Zone polygons may replace sectors later without changing the presence policy.)

### Presence evidence
- LD2450: any confirmed track inside zone i
- LD2410: debounced presence for zone i (if present)

### Presence policy
Same as requirements Section 1.8, applied per zone i.

---

## 2.6 Calibration design — priority #3

### 2.6.1 Overlap detection
Calibration constraints require overlapping FOV between radar pairs.

For radars i and j:
- angular separation `d = wrapAbsDeg(φ_i - φ_j)` in [0,180]
- each radar covers ±(FOV/2)
- overlap width in degrees:
  - `overlapDeg = RADAR_FOV_DEG - d`
- Pair is eligible for calibration if:
  - `overlapDeg >= CAL_PAIR_MIN_OVERLAP_DEG`

Eligible pairs form the **calibration pair list**.

### 2.6.2 Pair list strategies
Two supported modes:
- **Auto-detect (default):** derive `CAL_PAIR_LIST` from azimuths and FOV using `CAL_PAIR_MIN_OVERLAP_DEG`
- **Explicit list:** provide `CAL_PAIR_LIST` directly (overrides auto-detect)

### 2.6.3 What is solved
Yaw offsets δ are solved using overlap pair residual constraints:
- δ0 fixed to 0
- other δ_i are solvable only to the extent the overlap graph constrains them

If there are **no eligible pairs**, calibration is disabled (no updates).

### 2.6.4 Session-based conservative solver
Same as before:
- collect overlap samples (i,j,k) only when unambiguous
- solve δ by minimizing pair residuals + regularization
- strict acceptance gates
- circular EMA smoothing
- persist accepted updates

---

# 3. Exact Initial Parameter Defaults

These are the exact initial defaults. Defaults assume 4×90° layout, but support any `RADAR_AZIMUTH_DEG[]`.

## 3.1 Layout / geometry
- `RADAR_AZIMUTH_DEG = [0, 90, 180, 270]` (default example; user-configurable)
- `RADAR_FOV_DEG = 120`
- `TUBE_DIAMETER_MM = 110`
- `TUBE_RADIUS_MM = 55`
- `R_MAX_MM = 3000`

## 3.2 Timing / processing
- `MAX_DT_MS = 400`
- `TRACK_DROP_TIMEOUT_MS = 1500`
- `OUTPUT_RATE_HZ = 10`

## 3.3 KF tuning
- `PROC_NOISE_ACCEL_MM_S2 = 1200`
- `MEAS_NOISE_BASE_MM_BY_RADAR = 160` (single default; may be expanded per-radar later)
- `INITIAL_POS_VAR_MM2 = 500^2`
- `INITIAL_VEL_VAR_MM2_S2 = 1200^2`

## 3.4 Measurement quality scaling
- `FOV_DEG = 120`
- `EDGE_BEARING_FULL_DEG = 25`
- `EDGE_BEARING_CUTOFF_DEG = 55`
- `EDGE_NOISE_SCALE_MAX = 4.0`
- `RANGE_FULL_MM = 1200`
- `RANGE_CUTOFF_MM = 3000`
- `RANGE_NOISE_SCALE_MAX = 3.0`
- `JITTER_WINDOW_MS = 500`
- `JITTER_FULL_MM = 60`
- `JITTER_CUTOFF_MM = 250`
- `JITTER_NOISE_SCALE_MAX = 3.0`

## 3.5 Association / gating
- `GATE_D2_MAX = 9.21`
- `NEW_TRACK_CONFIRM_ENABLED = true`
- `NEW_TRACK_CONFIRM_COUNT = 2`
- `NEW_TRACK_CONFIRM_WINDOW_MS = 600`

## 3.6 Presence parameters (LD2450-only fallback)
- `ZONE_ENTER_CONFIRM_MS = 250`
- `ZONE_HOLD_MS = 2500`
- `ZONE_CLEAR_CONFIRM_MS = 800`

## 3.7 LD2410 debounce and enablement
- `LD2410_ENABLED_DEFAULT = false`
- `LD2410_ON_CONFIRM_MS = 150`
- `LD2410_OFF_CONFIRM_MS = 600`

## 3.8 Calibration pair selection (NEW)
- `CAL_PAIR_MODE = "auto"` (`"auto"` or `"explicit"`)
- `CAL_PAIR_MIN_OVERLAP_DEG = 15`
- `PAIR_TIME_MAX_DELTA_MS = 80`
- `SESSION_END_GAP_MS = 600`

## 3.9 Calibration session minima
- `CAL_SESSION_MIN_PAIR_SAMPLES_TOTAL = 80`
- `CAL_SESSION_MIN_PAIR_SAMPLES_PER_ACTIVE_PAIR = 20`
- `CAL_SESSION_MIN_DISPLACEMENT_MM = 1200`
- `CAL_SESSION_MIN_EIGEN_RATIO = 0.08`

## 3.10 Calibration solver stability
- `CAL_REG_LAMBDA = 1e-3`
- `CAL_MAX_CONDITION_NUMBER = 1e6`
- `CAL_MAX_UPDATE_PER_SESSION_DEG = 1.0`
- `CAL_MAX_ABS_DELTA_DEG = 8.0`
- `CAL_VIOLATION_POLICY = "reject"`

## 3.11 Calibration acceptance / outliers
- `CAL_MAX_RMS_TOTAL_MM = 250`
- `CAL_MAX_RMS_PAIR_MM = 300`
- `CAL_MIN_IMPROVEMENT_RATIO_ENABLED = true`
- `CAL_MIN_IMPROVEMENT_RATIO = 1.10`
- `CAL_OUTLIER_MAX_DEG = 2.5`
- `CAL_OUTLIER_CONFIRM_ENABLED = true`
- `CAL_OUTLIER_CONFIRM_COUNT = 2`
- `CAL_OUTLIER_CONFIRM_WINDOW_SESSIONS = 3`
- `CAL_OUTLIER_CONFIRM_BAND_DEG = 1.0`

## 3.12 Calibration smoothing
- `CAL_EMA_ALPHA_BASE = 0.15`
- `CAL_EMA_ALPHA_MIN = 0.03`
- `CAL_EMA_ALPHA_MAX = 0.25`
- `CAL_SESSION_QUALITY_MIN = 0.35`
- `CAL_Q_W_DISP = 1.0`
- `CAL_Q_W_COV = 1.0`
- `CAL_Q_W_COVG = 1.0`
- `CAL_Q_W_RMS = 1.0`

## 3.13 Persistence
- `CAL_STORE_FORMAT = "json"`
- `CAL_STORE_VERSION = 1`
- `CAL_STORE_ATOMIC_WRITE = true`
- `CAL_STORE_MAX_HISTORY = 50`

---

# 4. Notes

## 4.1 Layout flexibility
- Partial coverage (e.g., 270°) is supported by providing azimuths for only the mounted radars.
- Presence and tracking remain functional without overlap.
- Calibration requires overlap; if the auto-detected pair list is empty, calibration produces no updates.

## 4.2 LD2410 mounting (30 cm below LD2450)
- LD2410 affects zone presence only; vertical offset does not affect coordinate transforms.
- LD2410 does not participate in calibration math.

---
