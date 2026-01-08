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
1) Install dependencies
2) Create `config/defaultConfig.json5`
3) Run in sim mode:
  - `node src/app/appRunner.js --mode sim --log-level info`

## Modes
- `--mode sim`: CLI tool injects semantic events (presence/vibration/button) to the main bus
- `--mode hw`: Drivers publish raw domain events to domain buses, domain controllers normalize to main bus

> Note: hw mode currently uses Virtual signals for some drivers until RPi GPIO/serial drivers are implemented.
