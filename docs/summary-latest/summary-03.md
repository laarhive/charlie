We have a fully event-driven Node.js architecture for an interactive mascot (“Charlie”) targeting Raspberry Pi 4 (Debian). Charlie is a system composed of a Pi runtime + an Android AI client (Tasker + ChatGPT Voice) connected over LAN/WireGuard. The Node.js app handles sensors, rules, state machine, orchestration, and exposes a WebSocket RPC API used by a remote CLI (and future Web UI). We have strong virt/hw parity, explicit platform boundaries, and a solid, multi-layer test suite (unit + process-level integration).

📌 PROJECT SUMMARY — Project CHARLIE (UPDATED, POST CONTROL-PLANE HARDENING)

1️⃣ What Charlie is (high level)

Charlie is an interactive restaurant mascot designed to:

Detect presence in front (passersby) and back (people exiting) zones

Detect physical interaction (vibration + button / reed)

Decide when to start/stop conversations using configurable rules/timers

Orchestrate voice conversations via an AI client (Android + Tasker + ChatGPT Voice)

Run autonomously outdoors with observability, remote debugging, and safe recovery

Charlie is composed of multiple cooperating components:

Raspberry Pi runtime (Node.js): sensing, decision logic, orchestration, control plane APIs

AI client (Android + Tasker): speech recognition, AI inference, voice output

Connectivity: LAN or WireGuard tunnel

2️⃣ Hardware overview

Raspberry Pi 4 (Debian, headless)

Presence sensors

LD2410 (current; binary)

LD2450 planned later (coordinates-based)

Vibration sensors

SW-420 (light/heavy variants)

Button

GPIO push button or reed switch + magnet (service / secure actions)

LED

WS2812 planned (not implemented yet)

Phone

Android (Pixel 4 / 8)

Runs ChatGPT Voice and is controlled via Tasker

Audio

External mic + speaker

GPIO backends

pigpio (default; glitch filtering + reliable callbacks)

libgpiod (fallback)

VirtualBinarySignal (virt + non-Linux platforms)

3️⃣ Core software architecture (Node.js)

Design principles

Event-driven (no polling)

Separation of concerns

Hardware-agnostic domain logic

Full virt ↔ hw parity

Deterministic, testable components (Clock + scheduler)

Explicit platform boundaries (no accidental native imports)

4️⃣ Event buses (critical concept)

Multiple EventBus instances:

presence — raw presence domain events

vibration — raw vibration domain events

button — raw button domain events

tasker — conversation adapter / Tasker-related events

main — semantic events consumed by CharlieCore

Buses can be:

tapped locally (CLI)

streamed remotely over WebSocket (WS control plane)

5️⃣ Event flow (end-to-end)
Signal (GPIO / virt)
→ Driver (hw layer)
→ Domain bus (presence / vibration / button)
→ Domain controller (debounce / cooldown / normalization)
→ Main bus
→ CharlieCore (state machine + rules)
→ Conversation adapter (Tasker HTTP)


Virt mode uses VirtualBinarySignal, but the pipeline is identical.

6️⃣ Domain controllers

Implemented:

BinaryPresenceController

VibrationController

ButtonController (basic)

Responsibilities:

debounce / cooldown

normalization

emit semantic events:

presence:enter, presence:exit

vibration:hit

button:press

Core logic never touches raw GPIO.

7️⃣ Drivers (hardware-facing)

Drivers publish raw domain events only:

Ld2410Driver

Sw420Driver

GpioButtonDriver

All drivers expose:

getSensorId(), getType(), getRole(), getBus()

isEnabled() / setEnabled(enabled)

isStarted() (for debugging / observability)

start() / dispose()

8️⃣ GPIO abstraction & platform safety (IMPORTANT UPDATE)

Binary signals:

VirtualBinarySignal (virt + non-Linux)

GpioBinarySignalPigpio (Linux, default)

GpioBinarySignalGpiod (Linux fallback)

Critical architectural change (this chat):

Native GPIO imports (pigpio, gpiod) are now strictly isolated to Linux-only modules

createGpioBinarySignal.js is platform-safe and can be imported on Windows/macOS

Linux-only logic lives in createGpioBinarySignal.linux.js

This avoids ESM eager-import crashes on Windows

Behavior on Raspberry Pi is unchanged

JSDoc comments explicitly document:

platform boundaries

safe vs unsafe imports

architectural intent

9️⃣ Configuration

Config is JSON5 (config/defaultConfig.json5), includes:

sensors: { id, enabled, role, type, zone, hw }

core params (armingDelay, cooldown, etc.)

rule definitions (time / zone based)

Tasker config (baseUrl, timeouts)

GPIO backend selection:

gpio: { backend: 'pigpio' } // or 'gpiod'


SQLite config/versioning planned later (not implemented yet).

🔟 CharlieCore

Consumes only the main bus.

State machine:

IDLE → ARMED → TALKING → COOLDOWN


Applies rules based on zone/time

Emits conversation actions via conversation adapter

Rules are data-driven (not hardcoded)

1️⃣1️⃣ Clock + scheduler

Custom Clock abstraction (freeze / resume / advance / set)

Used heavily for deterministic testing

TimeScheduler emits time events

No polling loops

1️⃣2️⃣ Web server + Control Plane (hardened)

The Node.js app runs a WebServer (uWebSockets.js) exposing:

WebSocket

/ws — RPC + streaming taps

REST

/api/status

/api/config

Tasker dev endpoints

/tasker/start

/tasker/stop

WS RPC surface (stable contract)

state.get, config.get

inject.enable, inject.disable, inject.event

bus.tap.start, bus.tap.stop (streams bus.event)

driver.list, driver.enable, driver.disable

WS API is documented in docs/api/ws.md and treated as backward-compatible.

1️⃣3️⃣ CLI (local + remote parity)

Two CLI modes:

Local CLI (in-process)

--cli

Used mainly for development / virt mode

Now prints live tap events correctly using logger-backed sinks

Remote CLI (recommended)

--cmd cli

Connects over WS to a running daemon

Fully supports:

taps (live streaming)

state/config inspection

driver enable/disable

semantic injection

Example:

node src/app/appRunner.js --cmd daemon --mode virt
node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787


Local and WS CLI now have functional parity for taps.

1️⃣4️⃣ Deployment

Target: run Charlie as a systemd service on the Pi.

Docs:

docs/setup/raspberry-pi-gpio.md (pigpiod systemd + config)

docs/setup/raspberry-pi-systemd.md (charlie.service)

Deployment checklist in README

1️⃣5️⃣ Testing (expanded & hardened)

Testing uses Mocha with two layers:

Unit tests

core/state/rules/scheduler

deterministic, in-process

Process-level integration tests

Spawn real appRunner in a child process (virt mode)

Communicate only via public WS API

Native crash containment (important for uWebSockets.js)

Integration harness
test/helpers/charlieHarness.js provides:

spawn daemon on free port

wait for WS readiness

connect WS + send RPC

stop daemon

capture stdout/stderr

NEW in this chat: Tap Stream Integration Test

Added test/ws/tapStream.spec.js, which validates:

streaming of multiple events

per-bus isolation

correct payload shape (bus, subId, event)

bus.tap.stop actually stops streaming

All tests pass.

1️⃣6️⃣ Logging

Custom Logger wrapper over Winston

Syslog-style levels

JSON metadata

Timestamp format: MMM DD HH:mm:ss

Tap output routed through logger (not console.log)

1️⃣7️⃣ Current state (IMPORTANT)

✅ Event-driven architecture complete
✅ Domain buses/controllers stable
✅ Drivers implemented with observability (started, enabled)
✅ pigpio + gpiod backends implemented and platform-safe
✅ WebServer + WS RPC control plane hardened
✅ Local CLI taps fixed and visible
✅ Remote CLI over WS fully functional
✅ WS API documented and contract-tested
✅ Tap stream integration test added and passing
✅ Cross-platform dev environment (Windows/Linux) safe
✅ Ready for Raspberry Pi preflight + hardware smoke tests

🚧 Next work (now unblocked)

Raspberry Pi virt-mode preflight (daemon + WS CLI on real Pi)

systemd service validation (restart, logs, stability)

Hardware smoke tests (one sensor at a time):

Button / SW-420

LD2410 presence

Tasker real phone integration

Harden WS exposure (bind localhost, SSH/WireGuard)

Web UI (later)

Telemetry (later)

WS2812 LED control (later)

1️⃣8️⃣ Repo structure (updated tests layout)

Folder PATH listing
Volume serial number is 967D-7213
C:.
│
├───config
│       defaultConfig.json5
├───docs
│   │   api.md
│   │   configuration.md
│   │   hardware.md
│   │   node-architecture.md
│   │   phone-setup.md
│   │   simulation.md
│   │   structure.txt
│   │   system-diagram.md
│   │   system-overview.md
│   │   tasker-endpoints.md
│   ├───api
│   │       ws.md
│   ├───setup
│   │       raspberry-pi-deployment-checklist.md
│   │       raspberry-pi-gpio.md
│   │       raspberry-pi-systemd.md
│   └───summary-latest
│           structure.txt
│           summary-01.md
│           summary-02.md
│           summary-03.md
├───src
│   ├───app
│   │       appRunner.js
│   │       args.js
│   │       buses.js
│   │       cliRunner.js
│   │       configLoader.js
│   │       context.js
│   │       controlService.js
│   │       domainControllers.js
│   │       hwDrivers.js
│   │       taps.js
│   │       webServer.js
│   ├───cli
│   │       charlieWsClient.js
│   │       cliCompleter.js
│   │       cliController.js
│   │       cliHelp.js
│   │       cliParser.js
│   │       cliWsController.js
│   ├───clock
│   │       clock.js
│   ├───conversation
│   │       fakeConversationAdapter.js
│   │       taskerConversationAdapter.js
│   ├───core
│   │       busTap.js
│   │       charlieCore.js
│   │       eventBus.js
│   │       eventTypes.js
│   │       promptAssembler.js
│   │       ruleEngine.js
│   │       stateMachine.js
│   │       timeScheduler.js
│   ├───domain
│   │   │   domainEventTypes.js
│   │   │   
│   │   ├───button
│   │   │       edgeButtonController.js
│   │   │       pushButtonController.js
│   │   │       
│   │   ├───presence
│   │   │       binaryPresenceController.js
│   │   │       presenceController.js
│   │   │       targetsPresenceController.js
│   │   │       
│   │   └───vibration
│   │           hitVibrationController.js
│   │           vibrationController.js
│   ├───hw
│   │   ├───button
│   │   │       gpioButtonDriver.js
│   │   ├───presence
│   │   │       ld2410Driver.js
│   │   ├───signal
│   │   │       createGpioBinarySignal.js
│   │   │       createGpioBinarySignal.linux.js
│   │   │       gpioBinarySignalGpiod.js
│   │   │       gpioBinarySignalPigpio.js
│   │   │       virtualBinarySignal.js
│   │   └───vibration
│   │           sw420Driver.js
│   └───logging
│           logger.js
└───test
│   README.md
├───helpers
│       charlieHarness.js
│       flush.js
├───unit
│       charlieCore.spec.js
│       ruleEngine.spec.js
│       stateMachine.spec.js
│       timeScheduler.spec.js
└───ws
        cliWsController.spec.js
        tapStream.spec.js
        wsAppRunner.spec.js
        wsContract.spec.js
--


Goal: continue development and deployment from this exact state in a new chat, without losing architectural or testing context.
