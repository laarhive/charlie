# Configuration

Charlie is configured using a **single human-editable configuration file** that defines sensors, rules, prompts, and runtime behavior.

The configuration is intentionally **data-driven**: changing behavior should rarely require code changes.

---

## Current format

- **JSON5** (comments, trailing commas, readable diffs)
- Designed for direct human editing
- Future-proofed for migration to a database backend

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

## Top-level sections

### `sensors[]`

Defines **all sensing and interaction devices** known to the system.

Each sensor describes:
- *what it is* (role, type)
- *when it is active* (modes, enabled)
- *how it is connected* (hardware backend)
- *how it should be interpreted* (params)

Sensors are activated based on the selected runtime mode.

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
- Changes to the config affect behavior without code changes
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
