<!-- docs/architecture/recording/recording.cli-and-profiles.md -->
# Recording CLI and Recording Profiles

This document defines the **Recording CLI** surface and the **Recording Profile** file format used to drive recording and playback.

It intentionally does **not** document internal implementation (Player, Recorder, Store, routing internals), except where required to understand CLI behavior.

---

## 1. Terminology

- **recording**  
  A `.json5` file containing captured events, metadata, and stream observations.

- **profile**  
  A `.json5` file defining how recordings are created and how they are replayed.

- **variantKey**  
  A named override block inside `profile.record` or `profile.play` that modifies base parameters.

- **fileNameBase**  
  Base name used when generating new recording files.

- **fileName**  
  Explicit recording file name to load/play.

---

## 2. Directory layout

All paths are resolved relative to the configured recordings directory (default `.recordings/`).

```
.recordings/
├─ profiles/
│  ├─ rec-profile-presenceRaw.json5
│  └─ ...
├─ 01-presenceRaw-calibration-240209-123804.json5
├─ 02-presenceRaw-calibration-240209-124015.json5
└─ ...
```

- `profiles/` contains **profile files**
- recording output files live directly in `.recordings/`

---

## 3. CLI Commands

### 3.1 `recording status`

Shows current service state.

```
recording status
```

Includes:
- loaded profile (if any)
- recording state
- playback state
- last saved recording path

---

### 3.2 `recording load <profile.json5>`

Loads a recording profile.

```
recording load rec-profile-presenceRaw.json5
```

Rules:
- file must exist in `profiles/`
- replaces any previously loaded profile

---

### 3.3 `recording record [variantKey]`

Starts a recording using the loaded profile.

```
recording record
recording record dur10s
```

Rules:
- profile **must** be loaded
- uses `profile.record.params` as base
- optional `variantKey` merges overrides
- no additional CLI parameters allowed
- if already recording → logs and returns (no error)

---

### 3.4 `recording record stop`

Stops the active recording and writes the output file.

```
recording record stop
```

The output file name is auto-generated using:
- counter prefix (`01`, `02`, …)
- `fileNameBase`
- timestamp
- optional comment suffix

---

### 3.5 `recording play [variantKey] [fileName]`

Plays a recording.

```
recording play
recording play speed2
recording play speed2 02-presenceRaw-calibration-240209-124015.json5
```

Resolution order:
1. `fileName` argument (if provided)
2. `profile.play.params.fileName` (if present)
3. error if neither is available

Rules:
- uses `profile.play.params` as base
- optional `variantKey` merges overrides
- fileName overrides profile fileName

---

### 3.6 `recording play last [variantKey]`

Plays the most recent recording matching the current profile.

```
recording play last
recording play last speed2
```

“Last” is resolved by:
- numeric counter prefix
- matching `fileNameBase`

---

### 3.7 Playback control

Pause:
```
recording play pause
```

Resume (optional speed override):
```
recording play resume
recording play resume 2
```

Stop:
```
recording play stop
```

Notes:
- `resume <speed>` only adjusts speed
- does not re-evaluate profile parameters

---

## 4. Recording Profile format

Profiles are JSON5 files with the following structure:

- `profile` (string, required)
- `record` (object, required)
- `play` (object, required)

### 4.1 Record section

- `record.op` must be `"record.start"`
- `record.params` defines base parameters
- any additional keys are **record variants**

Supported base params include (non-exhaustive):
- `busNames`
- `duration`
- `select`
- `meta`
- `fileNameBase`

---

### 4.2 Play section

- `play.op` must be `"play.start"`
- `play.params` defines base parameters
- any additional keys are **play variants**

Supported base params include:
- `speed`
- `routingByStreamKey`
- `rewriteTs`
- `isolation`
- `eventRange`
- `fileName`

---

## 5. Complete example profile

```json5
// .recordings/profiles/rec-profile-presenceRaw.json5
{
  profile: 'presenceRaw-calibration',

  record: {
    op: 'record.start',
    params: {
      busNames: ['presence'],
      duration: '1s',

      select: {
        includeStreamKeys: [
          '*::presenceRaw:*::presence',
        ]
      },

      fileNameBase: 'presenceRaw-calibration',

      meta: {
        note: 'tracking calibration'
      }
    },

    dur10s: {
      duration: '10s',
      meta: {
        note: 'tracking calibration (10s)'
      }
    }
  },

  play: {
    op: 'play.start',
    params: {
      speed: 1,

      routingByStreamKey: {
        '*::presenceRaw:*::presence': 'device'
      },

      rewriteTs: true,

      isolation: {
        blockDevices: ['LD2450A', 'LD2450B', 'LD2450C'],
        unblockOnStop: true,
        owner: 'playback',
        reason: 'presence-replay'
      }
    },

    speed2: {
      speed: 2
    },

    last: {
      // play last recording for this profile
    },

    slowFile: {
      fileName: '02-presenceRaw-calibration-240209-124015.json5',
      speed: 0.5,
      rewriteTs: false
    }
  }
}
```

---

## 6. Design guarantees

- Recorder and Player receive **fully resolved params**
- CLI does not inject ad-hoc overrides
- Profiles are the single source of truth
- Variants are explicit, named, and discoverable
- Recording output includes:
  - profile filename
  - applied recording params
  - mode (from service constructor)

---

## 7. Non-goals

This document does **not** define:
- event schema
- formatter layouts
- bus or device semantics
- routing precedence rules

Those are covered in separate architecture documents.

---
