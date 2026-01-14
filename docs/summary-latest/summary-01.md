We have a fully event-driven Node.js architecture for an interactive mascot on Raspberry Pi, with domain buses, controllers, CLI, virt/hw parity, gpiod GPIO backend, and Tasker integration planned. We are ready to move from virt mode to real hardware tests and Tasker HTTP integration.

📌 PROJECT SUMMARY — Project CHARLIE

1️⃣ What Charlie is (high level)

Charlie is an interactive restaurant mascot running on a Raspberry Pi 4, designed to:

Detect people approaching or leaving (front/back presence)

Detect physical interaction (vibration, button)

Initiate and manage voice conversations via ChatGPT Voice on an Android phone (Tasker-controlled)

Operate autonomously outdoors, reliably, and observably

The Raspberry Pi does NOT do voice AI — it handles sensors, logic, state, and orchestration.

2️⃣ Hardware overview

Raspberry Pi 4 (Debian, headless)

Presence sensors

LD2410 (current)

LD2450 planned later (coordinates-based)

Vibration sensors

SW-420 (light / heavy)

Button

GPIO push button or reed switch

LED

WS2812 planned (not implemented yet)

Phone

Android (Pixel 4 / 8)

Runs ChatGPT Voice

Controlled via Tasker

Audio

External mic + speaker

GPIO backend: `libgpiod`

3️⃣ Core software architecture (Node.js)
Design principles

Event-driven

Strong separation of concerns

No polling

Hardware-agnostic domain logic

Full virt ↔ hw parity

4️⃣ Buses (very important)

Charlie uses multiple EventBus instances:

Bus	Purpose
presence	raw presence sensor events
vibration	raw vibration sensor events
button	raw button events
tasker	conversation adapter events
main	normalized semantic events consumed by core

All buses can be tapped for debugging (tap main on, etc).

5️⃣ Event flow (end-to-end)
Hardware signal (GPIO)
→ Driver (hw)
→ Domain bus (presence / vibration / button)
→ Domain Controller (debounce, cooldown, normalization)
→ Main bus
→ CharlieCore (state machine + rules)
→ ConversationAdapter (Tasker HTTP)


Virt mode uses VirtualBinarySignal, but the flow is identical.

6️⃣ Domain controllers

Implemented:

BinaryPresenceController

VibrationController

ButtonController (basic)

Responsibilities:

Debounce

Cooldowns

Normalization

Emitting semantic events like:

presence:enter / exit

vibration:hit

button:press

Core logic never touches raw GPIO.

7️⃣ Drivers (hardware-facing)

Drivers publish raw domain events, nothing else.

Implemented:

Ld2410Driver

Sw420Driver

GpioButtonDriver

Drivers:

consume a binary signal

publish presenceRaw:*, vibrationRaw:*, buttonRaw:*

can be enabled/disabled at runtime

8️⃣ GPIO abstraction

Binary signals are abstracted:

VirtualBinarySignal (virt mode)

GpioBinarySignalPigpio (default hw)

GpioBinarySignalGpiod (fallback hw)

Selected via config:

gpio: {
backend: 'pigpio' // or 'gpiod'
}

9️⃣ Configuration

Config is currently JSON5, loaded from /config.

Includes:

sensors (id, type, role, zone, hw params)

core params (armingDelay, cooldown)

rules (time / zone based)

tasker config (baseUrl, timeouts)

prompt text (base, modes, openers)

SQLite planned later, but not yet introduced.

🔟 CharlieCore

Consumes only main bus

Maintains a state machine (IDLE → ARMED → TALKING → COOLDOWN)

Applies rules based on:

zone

time of day / weekday

Emits conversation actions (start / stop)

Rules are not hardcoded.

1️⃣1️⃣ Clock + scheduler

Custom Clock abstraction

Can be frozen / advanced / set

Used for:

testing

deterministic scheduling

TimeScheduler emits time events (no tick loop)

1️⃣2️⃣ CLI (very important)

CLI works in both virt and hw mode.

Features:

Command parser + readline

Context-aware autocomplete (command tree)

Commands grouped semantically

Injection guarded by inject on|off

Shows clock status + inject status in prompt

Example commands:

presence front on
vibration high
button short
tap main on
clock freeze
clock +5000
driver list
driver enable <sensorId>
virt set <sensorId> on


CLI can:

inspect state

tap buses

inject events (virt)

control clock

enable/disable drivers

CLI is not sim-only.

1️⃣3️⃣ Modes

There is no “sim app” anymore.

Modes:

--mode hw → real drivers

--mode virt → virtual signals

--cli → optional interactive CLI

Injection is guarded via:

inject on | off

1️⃣4️⃣ Tasker integration (planned / partial)

TaskerConversationAdapter

HTTP-based

Base URL configurable

Simulated Tasker server planned using uWebSockets.js

Tasker will POST back:

conversation started

conversation ended

(later) telemetry

Telemetry is explicitly postponed.

1️⃣5️⃣ Logging

Custom Logger wrapper

Internally uses Winston

Syslog-like levels

Pretty JSON (2 spaces)

Timestamp format: MMM DD HH:mm:ss

1️⃣6️⃣ pigpio setup

pigpio chosen as default GPIO backend

systemd unit created (pigpiod.service)

documented in:

docs/setup/raspberry-pi-gpio.md

1️⃣7️⃣ Current state (IMPORTANT)

✅ Architecture complete
✅ CLI + autocomplete complete
✅ Presence pipeline fully working (virt)
✅ Driver enable/disable works
✅ pigpio + gpiod both implemented
✅ System ready for real hardware tests

🚧 Next work (not yet done):

Raw CLI injection for vibration/button (if not already added)

Real LD2410 hardware smoke test

Real SW-420 + button wiring test

Tasker simulated HTTP server (uWebSockets)

Tasker real phone wiring

Web UI (later)

Telemetry (later)

WS2812 LED control (later)

1️⃣8️⃣ Key constraints / preferences

Node.js ES6+

No semicolons

2-space indentation

Classes with private fields

No polling

EventBus everywhere

Testable via Mocha

Production = Debian + RPi4

Testing = Win11

No ESP32-class constraints (RPi needed)

1️⃣9️⃣ project structure (directories + files):

src/
├─ app/
│  ├─ appRunner.js
│  ├─ context.js
│  ├─ buses.js
│  ├─ taps.js
│  ├─ hwDrivers.js
│  ├─ domainControllers.js
│  ├─ cliParser.js
│  └─ cliController.js
│
├─ core/
│  ├─ eventBus.js
│  ├─ charlieCore.js
│  ├─ timeScheduler.js
│  ├─ busTap.js
│  └─ eventTypes.js
│
├─ domain/
│  ├─ domainEventTypes.js
│  ├─ presence/
│  │  └─ binaryPresenceController.js
│  ├─ vibration/
│  │  └─ vibrationController.js
│  └─ button/
│     └─ buttonController.js
│
├─ hw/
│  ├─ presence/
│  │  └─ ld2410Driver.js
│  ├─ vibration/
│  │  └─ sw420Driver.js
│  ├─ button/
│  │  └─ gpioButtonDriver.js
│  └─ signal/
│     ├─ virtualBinarySignal.js
│     ├─ gpioBinarySignalPigpio.js
│     ├─ gpioBinarySignalGpiod.js
│     └─ createGpioBinarySignal.js
│
├─ cli/
│  └─ cliCompleter.js
│
├─ clock/
│  └─ clock.js
│
├─ logging/
│  └─ logger.js
│
├─ testing/
│  └─ fakeConversationAdapter.js
│
config/
├─ defaultConfig.json5
│
docs/
├─ setup/
│  └─ raspberry-pi-gpio.md
│
test/
├─ charlieCore.spec.js
├─ ruleEngine.spec.js
├─ stateMachine.spec.js


The idea is to run the app as a system service. Currently the cli works if i start the app manually.

The idea is to:
* be able to run the cli even if the app is run as a service
* also integrate a webui to configure (and test)

I would suggest that cli is started as a different app (or same up but start cli independently and be able to interract with the main app)
I suggest we provide an websocket API for the app both for cli (and second step for the webui)

your suggestion?
