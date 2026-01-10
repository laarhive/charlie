# Charlie — Interactive Restaurant Mascot

Charlie is an outdoor restaurant mascot that detects people near the entrance, initiates voice conversations, and guides interactions in a friendly, human way. The Raspberry Pi handles sensing + decision logic. A phone handles voice (ChatGPT Voice) via Tasker automation.

## What Charlie does
- Detects presence in **front** (passersby) and **back** (people exiting) zones
- Decides when to start/stop a conversation using configurable rules and timers
- Triggers ChatGPT Voice on the phone with the right “conversation mode” and context
- Logs events for debugging and future analytics
- Supports simulation mode for development without hardware

## High-level architecture
Charlie is a distributed system with two main components:

1) **Raspberry Pi (Node.js)**
  - Reads sensors and normalizes their signals
  - Runs the core state machine + scheduling
  - Publishes events on internal buses
  - Sends start/stop commands to the phone
  - Receives callbacks (later) about conversation lifecycle

2) **Android phone (ChatGPT Voice + Tasker)**
  - Runs ChatGPT Voice (audio in/out)
  - Tasker receives triggers from Pi and opens ChatGPT, injects prompts, starts voice mode
  - Tasker sends callbacks (optional) to Pi with conversation started/ended + telemetry

## Documentation
- [System overview](docs/system-overview.md)
- [Hardware](docs/hardware.md)
- [Phone setup](docs/phone-setup.md)
- [Node.js app architecture](docs/node-architecture.md)
- [Configuration](docs/configuration.md)
- [Simulation mode](docs/simulation.md)

## Quick start (development)
Install dependencies

Create config/defaultConfig.json5

Run in virtual hardware mode with CLI enabled:
```shell
node src/app/appRunner.js --mode virt --cli --log-level info
```
This starts the full Charlie pipeline (drivers → domain controllers → core) using virtual hardware drivers, with the CLI attached for debugging and injection.

## Modes

`--mode virt`
* Starts the full hardware pipeline using virtual drivers/signals
* Domain buses and domain controllers are active
* Raw domain events are produced by virtual drivers
* CLI injection is enabled by default
* Intended for:
  - development on non-RPi machines (Win11/macOS)
  - testing driver → domain → core wiring
  - troubleshooting without physical hardware

`--mode hw`
* Starts the full hardware pipeline using real hardware drivers (GPIO / serial)
* Domain buses and domain controllers are active
* CLI is disabled by default (can be enabled with --cli)
* CLI injection is disabled by default (can be enabled at runtime with inject on)
* Intended for:
  - deployment on Raspberry Pi
  - real sensor operation

`--cli` (optional)
* Attaches the interactive CLI in either mode
* Allows:
  - enabling/disabling bus taps
  - inspecting core state and config
  - controlling the clock (freeze / advance)
  - optionally injecting semantic events (guarded by inject on|off)
* Features:
  - context-aware tab completion (press Tab to explore available commands)

> Note:<br>
> In virt mode, drivers use virtual signals as stand-ins for real hardware.<br>
> In hw mode, virtual drivers are not started; real GPIO/serial drivers are expected to be wired instead.
