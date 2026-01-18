# Simulation Mode

## Purpose
- Fast iteration on CharlieCore behavior without hardware
- Reproduce scenarios deterministically using clock controls

## Commands
- `inject on|off|status`
- `presence front|back on|off`
- `vibration low|high`
- `button short|long`
- `virt list|set <sensorId> on|off`
- `driver list|enable|disable <sensorId>`
- `clock now|status|freeze|resume|+MS|set YYYY-MM-DD HH:MM`
- `tap main|presence|vibration|button|tasker|all on|off|status`
- `core state`
- `config load <filename>|print`

> CLI features context-aware tab completion (press Tab to explore available commands)


## Philosophy
Simulation commands inject semantic events directly into the main bus.
This allows validation of:
- state transitions
- arming delays
- cooldowns
- rule selection by time

Domain interpretation logic (debounce, raw parsing) is tested separately.
