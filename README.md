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

## Raspberry Pi setup
- [Raspberry Pi Deployment checklist](docs/setup/raspberry-pi-deployment-checklist.md)
- [Raspberry Pi GPIO setup (pigpio)](docs/setup/raspberry-pi-gpio.md)
- [Raspberry Pi systemd service (Charlie)](docs/setup/raspberry-pi-systemd.md)

## Quick start (development)

Install dependencies

Create `config/defaultConfig.json5`

### Start Charlie (daemon) in virtual hardware mode
```shell
node src/app/appRunner.js --cmd daemon --mode virt --log-level info
```

This starts the full Charlie pipeline (drivers → domain controllers → core) using **virtual hardware drivers** and exposes:
- WebSocket control API (`/ws`)
- REST API (`/api/*`)
- Tasker simulation endpoints (`/tasker/*`)

No interactive CLI is attached in this mode.

### Attach the CLI (local or remote)
In another terminal (same machine, SSH session, or another computer):

```shell
node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787
```

This connects to the running Charlie daemon over WebSocket and provides an interactive CLI for debugging, inspection, and controlled injection.

---

## Modes

### `--mode virt`
- Starts the full hardware pipeline using **virtual drivers / signals**
- Domain buses and domain controllers are active
- Raw domain events are produced by virtual drivers
- Injection can be enabled at runtime via the CLI (`inject on`)
- Intended for:
  - development on non-RPi machines (Win11 / macOS / Linux)
  - testing driver → domain → core wiring
  - troubleshooting logic without physical hardware

### `--mode hw`
- Starts the full hardware pipeline using **real hardware drivers** (GPIO / serial)
- Domain buses and domain controllers are active
- Injection is **disabled by default** (can be enabled explicitly via CLI)
- Intended for:
  - deployment on Raspberry Pi
  - real sensor operation

---

## Command modes

### `--cmd daemon` (default)
- Runs Charlie as a **long-running service**
- Starts:
  - hardware drivers (virtual or real)
  - domain controllers
  - core state machine
  - Web server (WS + REST)
- No interactive CLI is attached
- Intended for:
  - systemd service execution
  - headless operation

### `--cmd cli`
- Starts a **standalone CLI client**
- Connects to a running Charlie daemon via WebSocket
- Can be run:
  - on the same machine
  - over SSH
  - on another computer on the network
- Allows:
  - inspecting core state and config
  - enabling/disabling bus taps (live event streaming)
  - enabling/disabling injection
  - injecting semantic events (presence / vibration / button)
  - enabling/disabling hardware drivers

---

## Legacy local CLI (`--cli`, optional)

```shell
node src/app/appRunner.js --mode virt --cli
```

- Attaches the interactive CLI **inside the daemon process**
- Mainly intended for:
  - early development
  - quick local debugging
- Not suitable for:
  - systemd services
  - remote access
  - multiple concurrent CLI sessions

> For normal operation and deployment, prefer `--cmd daemon` + `--cmd cli`.

---

> **Notes**  
> • In `virt` mode, drivers use virtual signals as stand-ins for real hardware.  
> • In `hw` mode, real GPIO / serial drivers are expected to be wired.  
> • Multiple CLI clients can attach to the same running daemon simultaneously.  
> • In production, the WebSocket server can be bound to `localhost` and accessed via SSH tunneling or a reverse proxy.
