We have a fully event-driven Node.js architecture for an interactive mascot (“Charlie”) targeting Raspberry Pi 4 (Debian). Charlie is a system composed of a Pi runtime + an Android AI client (Tasker + ChatGPT Voice) connected over LAN/WireGuard. The Node.js app handles sensors, rules, state machine, orchestration, and exposes a WebSocket RPC API used by a remote CLI (and future Web UI). We have strong virt/hw parity and a solid test suite (unit + process-level integration).

📌 PROJECT SUMMARY — Project CHARLIE (UPDATED)

1️⃣ What Charlie is (high level)

Charlie is an interactive restaurant mascot designed to:

Detect presence in front (passersby) and back (people exiting) zones

Detect physical interaction (vibration + button / reed)

Decide when to start/stop conversations using configurable rules/timers

Orchestrate voice conversations via an AI client (Android + Tasker + ChatGPT Voice)

Run autonomously outdoors with observability and remote debugging

Charlie is composed of multiple cooperating components:

Raspberry Pi runtime (Node.js): sensing, decision logic, orchestration, control plane APIs

AI client (Android + Tasker): speech recognition, AI inference, voice output

Connectivity: LAN or WireGuard tunnel

2️⃣ Hardware overview

Raspberry Pi 4 (Debian, headless)

Presence sensors:

LD2410 (current; binary)

LD2450 planned later (coordinates-based)

Vibration sensors:

SW-420 (light/heavy variants)

Button:

GPIO push button or reed switch + magnet (service/secure actions)

LED:

WS2812 planned (not implemented yet)

Phone:

Android (Pixel 4 / 8)

Runs ChatGPT Voice and is controlled via Tasker

Audio:

external mic + speaker

GPIO backend:

pigpio (default; supports glitch filtering + reliable callbacks)

libgpiod fallback also implemented

3️⃣ Core software architecture (Node.js)
Design principles:

Event-driven (no polling)

Separation of concerns

Hardware-agnostic domain logic

Full virt ↔ hw parity

Testable, deterministic components (Clock + scheduler)

4️⃣ Buses (very important)
Multiple EventBus instances:

presence: raw presence domain events

vibration: raw vibration domain events

button: raw button domain events

tasker: conversation adapter / Tasker-related events

main: semantic events consumed by core

Buses can be tapped for debugging and also streamed to clients over WebSocket.

5️⃣ Event flow (end-to-end)
Signal (GPIO/virt)
→ Driver (hw layer)
→ Domain bus (presence/vibration/button)
→ Domain controller (debounce/cooldown/normalization)
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

presence:enter / presence:exit

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

isStarted() (added for debugging)

start() / dispose()

8️⃣ GPIO abstraction
Binary signals:

VirtualBinarySignal (virt)

GpioBinarySignalPigpio (default hw)

GpioBinarySignalGpiod (fallback hw)

Selected via config:

gpio: { backend: 'pigpio' } // or 'gpiod'


9️⃣ Configuration
Config is JSON5 (config/defaultConfig.json5), includes:

sensors: { id, enabled, role, type, zone, hw }

core params (armingDelay, cooldown, etc.)

rules (time/zone-based)

tasker config (baseUrl, timeouts)
SQLite config/versioning planned later (not implemented yet).

🔟 CharlieCore
Consumes only main bus. Maintains state machine:

IDLE → ARMED → TALKING → COOLDOWN

Applies rules based on zone/time. Emits conversation actions via conversation adapter. Rules are not hardcoded.

1️⃣1️⃣ Clock + scheduler
Custom Clock abstraction (freeze/resume/advance/set) used for deterministic tests.
TimeScheduler emits time events; no polling tick loop.

1️⃣2️⃣ Web server + Control plane (NEW / IMPORTANT)
The Node.js app runs a WebServer (uWebSockets.js) exposing:

WS endpoint: /ws (RPC + taps; used by CLI and future Web UI)

REST endpoints: /api/status, /api/config

Tasker sim endpoints (dev): /tasker/start, /tasker/stop

WS RPC includes:

state.get, config.get

inject.enable, inject.disable, inject.event

bus.tap.start, bus.tap.stop (streams bus.event)

driver.list, driver.enable, driver.disable (via ControlService pass-through)

WS API is documented in: docs/api/ws.md and treated as a stable contract (backward compatible).

1️⃣3️⃣ CLI (split into local vs remote) (NEW / IMPORTANT)
There are now 2 ways to use CLI:

Legacy local CLI (in-process): --cli (mostly for quick dev)

Remote CLI client over WS: --cmd cli (recommended)

AppRunner supports:

--cmd daemon (default): runs daemon/service, no readline

--cmd cli: runs WS CLI client that connects to a running daemon

Example:

Start daemon:

node src/app/appRunner.js --cmd daemon --mode virt --log-level info

Attach CLI (same machine):

node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787

Attach CLI (another machine):

node src/app/appRunner.js --cmd cli --host <pi-ip> --port 8787

Remote CLI supports:

bus taps (live stream)

state/config inspection

driver enable/disable + list (includes started)

inject enable/disable + semantic injection (presence/vibration/button)

1️⃣4️⃣ Deployment
Goal is to run daemon as a systemd service on the Pi.
Docs:

docs/setup/raspberry-pi-gpio.md (pigpiod systemd + config)

docs/setup/raspberry-pi-systemd.md (charlie.service unit)
Also includes a deployment checklist section in README.

1️⃣5️⃣ Testing (NEW / IMPORTANT)
Testing uses Mocha with 2 layers:

Unit tests: core/state/rules + CLI WS mapping (fake client)

Integration tests: spawn real appRunner as a separate process (virt mode), then test WS contract over real WebSocket

Integration harness:

test/helpers/charlieHarness.js provides:

spawn daemon on free port

wait for WS ready

connect WS + send RPC requests

stop daemon

capture stdout/stderr for crash diagnostics

Contract tests validate all WS RPC commands (state/config/inject/driver/taps/errors) against a running daemon in virt mode.

Run tests:

npx mocha (or specific specs)

Integration specs live under test/ws/* and use the harness.

Important note: uWebSockets.js can be unstable under in-process test runners on Windows, so integration tests run Charlie in a child process (native crash containment).

1️⃣6️⃣ Logging
Custom Logger wrapper using Winston.
JSON logs, syslog-like levels, timestamp format: MMM DD HH:mm:ss.

1️⃣7️⃣ Current state (IMPORTANT)
✅ Event-driven architecture complete
✅ Domain buses/controllers in place
✅ Drivers implemented with enable/disable + started status
✅ pigpio + gpiod backends implemented
✅ WebServer with WS RPC control plane implemented
✅ Remote CLI over WS implemented (--cmd cli)
✅ WS API documented (docs/api/ws.md)
✅ Unit tests + process-level integration tests passing
✅ Ready for real hardware smoke tests + Tasker integration iteration

🚧 Next work

Real LD2410 hardware smoke test

Real SW-420 + button wiring tests

Harden WS exposure (bind localhost in prod; reverse proxy/ssh tunnel)

Tasker real phone wiring + callbacks verification

Web UI (later) using WS API

Telemetry (later)

WS2812 LED control (later)

1️⃣8️⃣ Repo structure (approx)
Key areas:

src/app/: appRunner, args, context, WebServer, ControlService

src/core/: EventBus, CharlieCore, scheduler, eventTypes

src/domain/: controllers + domainEventTypes

src/hw/: drivers + signal backends (virt/pigpio/gpiod)

src/cli/: parser, completer, local CLI controller, WS CLI controller + ws client

docs/api/ws.md: WS API contract

docs/setup/*: Pi GPIO + systemd service

test/: unit tests + integration tests (test/helpers/charlieHarness.js, test/ws/*)

Folder PATH listing
│   package.json
│   README.md
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
│   │   summary-01.md
│   │   summary-02.md
│   │   system-diagram.md
│   │   system-overview.md
│   │   tasker-endpoints.md
│   ├───api
│   │       ws.md
│   └───setup
│           raspberry-pi-deployment-checklist.md
│           raspberry-pi-gpio.md
│           raspberry-pi-systemd.md
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
│   │   ├───button
│   │   │       edgeButtonController.js
│   │   │       pushButtonController.js
│   │   ├───presence
│   │   │       binaryPresenceController.js
│   │   │       presenceController.js
│   │   │       targetsPresenceController.js
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
│   │   │       gpioBinarySignalGpiod.js
│   │   │       gpioBinarySignalPigpio.js
│   │   │       virtualBinarySignal.js
│   │   └───vibration
│   │           sw420Driver.js
│   └───logging
│           logger.js
└───test
│   charlieCore.spec.js
│   cliWsController.spec.js
│   ruleEngine.spec.js
│   stateMachine.spec.js
│   timeScheduler.spec.js
│   wsAppRunner.spec.js
│   wsContract.spec.js
└───helpers
    charlieHarness.js
    flush.js



Goal: continue development/testing in a new chat with this context.
