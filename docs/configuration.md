# Configuration

## Current format
- JSON5 for human editing
- Later: SQLite as source of truth with export-to-JSON snapshots

## Location
- `config/defaultConfig.json5`

## Key sections
### sensors[]
Defines available sensors and their parameters.

  Examples:
- Presence sensors:
  - id, type (ld2410/ld2450), role (presence), zone (front/back), enabled, params (debounce)
  - Vibration sensors:
  - id, type (sw420), role (vibration), level (low/high), params (cooldown)
  - Button:
- id, role (button), type, params

### rules[]
Scheduling and mode selection rules:
  - time ranges
- weekday selection
- zone selection
- action: which mode/opener/snippets or none

### promptText
Prompt library:
  - base persona
- mode prompts
- opener instructions (often creative instructions rather than fixed lines)

## Future plan
- Store config in SQLite
- Export canonical JSON snapshots on every change (git-friendly)
- Optionally commit/push snapshots automatically
