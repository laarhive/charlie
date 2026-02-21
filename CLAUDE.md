# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Charlie is an autonomous interactive mascot that senses people via radar sensors and orchestrates AI-powered voice conversations. It runs as a Node.js daemon on Raspberry Pi (production) or Windows (development).

## Commands

```bash
# Run on Windows (development, with interactive CLI)
node src/app/appRunner.js --mode win11 --port 8787 --interactive

# Run on Raspberry Pi (production daemon)
node src/app/appRunner.js --mode rpi4 --port 8787

# Run all tests
yarn test

# Run a single test file
yarn mocha test/unit/charlieCore.spec.js

# Run tests matching a pattern
yarn mocha --grep "pattern" "test/**/*.spec.js"
```

Yarn 4.12.0 with zero-installs — no `yarn install` needed. Dependencies live in `.yarn/cache`.

## Code Style

- Native ES modules (`"type": "module"` in package.json), no transpilation or bundling
- 2-space indentation, LF line endings, UTF-8
- Testing: mocha + chai (no assertion library wrappers)

## Architecture

### Event-Driven Pipeline

```
Hardware signals → Protocols (GPIO/serial/virtual) → Devices → Domain buses
→ Domain Controllers → Main bus → CharlieCore (state machine) → Conversation adapter
```

### Event Buses

Separate `EventBus` instances isolate concerns. Key buses: `main`, `presence`, `vibration`, `button`, `led`, `tasker`, `presenceInternal`. Domain controllers consume raw domain bus events, normalize them, and publish semantic events to `main`.

### Core State Machine (CharlieCore)

States: `IDLE` → `ARMING` → `ACTIVE` → `COOLDOWN`

CharlieCore subscribes to `main` bus events (`presence:enter`, `presence:exit`, `vibration:hit`, `button:press`, timer expirations) and uses a rule engine to decide when to start/stop conversations. Rules match on weekday, time of day, and presence zone.

### Device System

`src/devices/kinds/` — each device kind is a directory with its own decode/driver logic. All devices extend `BaseDevice` with lifecycle methods: `block(reason)`, `unblock()`, `inject(payload)`, `dispose()`, `getSnapshot()`.

Devices declare which modes they're active in (`modes: ['rpi4', 'win11']`). The `DeviceManager` filters devices by the current `--mode` flag.

Protocol types: `serial` (USB serial via serialport), `gpio` (libgpiod), `virt` (virtual, for testing).

### Presence Domain

The most complex domain. Pipeline: radar ingest adapters → coordinate transform → Kalman filter tracking → multi-radar fusion clustering → zone classification → `presence:enter`/`presence:exit` events on main bus.

Key files: `src/domains/presence/presenceController.js`, `src/domains/presence/tracking/trackingPipeline.js`, `src/domains/presence/ingest/`.

### Dependency Injection

`src/app/context.js` is the composition root — it wires all components together. Buses, clock, logger, and config are injected via constructor parameters. The `Clock` abstraction enables deterministic time-sensitive tests.

### Configuration

JSON5 files under `config/` with a modular `include` system rooted at `config/defaultConfig.json5`. Loaded by `src/app/configLoader.js`.

### Transport

`uWebSockets.js` serves HTTP routes and WebSocket connections. WebSocket clients can stream live events from any bus. Static files served from `public/`.

### Recording/Playback

`src/recording/` captures events from buses into JSON5 files (`.recordings/`) for offline replay and debugging.

## Test Structure

```
test/unit/       — fast, deterministic, in-process tests
test/ws/         — process-level WebSocket contract tests
test/devices/    — device conformance tests (shared contracts in test/devices/shared/)
test/helpers/    — charlieHarness.js (full app harness), flush utilities
```

Device conformance tests verify all device kinds implement the `BaseDevice` contract correctly. `fakeUsbSerialDuplex.js` simulates serial connections for testing.
