# Configuration

Charlie is configured using a **single human-editable configuration file** that defines sensors, rules, prompts, and runtime behavior.

The configuration is intentionally **data-driven**: changing behavior should rarely require code changes.

---

## Current format

- **JSON5** (comments, trailing commas, readable diffs)
- Designed for direct human editing
- Optimized for clarity and version control

Planned evolution:
- SQLite as the source of truth
- Automatic export to canonical JSON snapshots
- Snapshots remain git-friendly and reviewable

---

## Location

```
config/defaultConfig.json5
```

This file is loaded at startup and can be reloaded at runtime via the CLI.

---

## Operating modes (activation profiles)

Charlie does **not** use a global “virtual vs hardware” runtime mode.

Instead, Charlie uses **activation profiles**, selected via the CLI `--mode` parameter, to determine **which devices are active** in a given run.

An activation profile is an **arbitrary string** (for example `rpi4`, `win11`, `dev`, `test`) that is matched against each sensor’s configuration.

At startup, a sensor is activated **only if**:
- `enabled === true`
- `modes.includes(<current --mode>)`

This allows:
- a single configuration file to be reused across machines
- fine-grained control over which hardware is active
- mixing real and virtual devices in the same runtime

---

### Virtual and real hardware parity

Charlie treats **virtual and physical hardware identically** at the architectural level.

The distinction is expressed **only** in the sensor’s `hw` section:

- `hw.gpio` → real GPIO device
- `hw.serial` → USB / UART device (future)
- `hw.virtual` → virtual device driven by the CLI

All devices:
- go through the same drivers
- publish to the same domain buses
- are interpreted by the same domain controllers
- produce identical semantic events

This guarantees that:
- behavior tested on a laptop matches Raspberry Pi behavior
- domain logic does not depend on hardware type
- virtual devices can fully impersonate real ones

---

### Logical sensors and `publishAs`

Multiple physical or virtual devices may represent the **same logical sensor** using `publishAs`.

Example use case:
- a real GPIO button on the Raspberry Pi
- a virtual button on a laptop
- both publishing events as the same logical button ID

When `publishAs` is set:
- drivers publish raw events using the logical ID
- domain controllers and core logic cannot distinguish the source
- hardware can be swapped without changing behavior

This is particularly useful for mixed or staged testing.

---

## Top-level sections

### `sensors[]`

Defines **all sensing and interaction devices** known to the system.

Each sensor describes:
- *what it is* (role, type)
- *when it is active* (modes, enabled)
- *how it is connected* (hardware backend)
- *how it should be interpreted* (params)

Sensors are activated dynamically based on the selected activation profile.

---

#### Presence sensors

Used to detect people approaching or leaving.

Typical fields:
- `id` – unique identifier
- `role: "presence"`
- `type` – `ld2410` (binary) or `ld2450` (targets, future)
- `zone` – `front` or `back`
- `enabled`
- `modes` – activation profiles
- `params` – debounce timing
- `hw` – hardware backend (`gpio`, `serial`, or `virtual`)

---

#### Vibration sensors

Used to detect physical interaction (taps, knocks, hits).

Typical fields:
- `id`
- `role: "vibration"`
- `type: "sw420"` (current)
- `level` – `light` or `heavy`
- `enabled`
- `modes`
- `params` – cooldown timing
- `hw` – hardware backend

---

#### Buttons

Used for explicit user interaction.

Typical fields:
- `id`
- `role: "button"`
- `type: "button"`
- `enabled`
- `modes`
- `params` – cooldown, long-press thresholds (future)
- `publishAs` (optional) – logical button alias
- `hw` – hardware backend:
  - `gpio` – physical GPIO button
  - `virtual` – CLI-driven virtual button
  - `serial` – USB / UART button (future)

Buttons publishing the same `publishAs` are treated as the same logical button.

---

### `rules[]`

Defines **when and how Charlie reacts** to events.

Rules control:
- time-based behavior
- zone-based behavior
- weekday selection
- priority ordering

Each rule typically specifies:
- `id`
- `priority`
- `conditions`:
  - zone
  - weekday(s)
  - time ranges
- `actions`:
  - conversation mode
  - opener prompt
  - or no action

Rules are evaluated by the core state machine.

---

### `promptText`

Defines the **prompt library** used by the AI client.

Includes:
- `base` – global persona / system instruction
- `modes` – behavior-specific prompt modifiers
- `openers` – short creative instructions used to generate spoken openers

Prompts are **instructions**, not fixed text, allowing variation and creativity.

---

## Runtime behavior

- Sensors are filtered by:
  - `enabled === true`
  - `modes.includes(--mode)`
- Virtual and physical devices are treated identically after activation
- No branching logic exists in controllers or core based on hardware type
- Configuration changes affect behavior without code changes
- Config can be reloaded at runtime via the CLI

---

## Future plan

- Migrate configuration storage to SQLite
- Maintain JSON snapshots as the canonical exported form
- Enable optional automatic snapshot commits
- Support config editing via Web UI while preserving auditability

---

## Design intent

The configuration system is designed to be:
- explicit
- inspectable
- safe to modify
- easy to diff and review
- decoupled from implementation details

If a behavior change requires a code change instead of a config change, it is considered a design smell.
