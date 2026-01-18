# Project CHARLIE


## What Charlie does

Charlie is an autonomous interactive mascot that senses people in the real world and orchestrates AI-powered voice conversations in response.

It can:

- Detect people approaching in **front** and leaving from **behind**
- Decide **when to start or stop a conversation** using configurable rules and timers
- Trigger **ChatGPT Voice** on a phone with the appropriate conversation mode and context
- React to **physical interaction** such as vibration or button presses
- Log events for debugging and future analytics


## 1. Project overview

### Purpose

Charlie is responsible for:
- detecting nearby people (presence sensors)
- detecting physical interaction (vibration, button, reed switch)
- applying rules and state transitions
- coordinating conversations via an external voice AI client
- running autonomously as a long-lived system service

Charlie is composed of multiple cooperating components with clearly defined responsibilities.

The Node.js application running on the Raspberry Pi is responsible for:
- sensing and interaction (presence, vibration, buttons)
- state management and decision logic
- orchestration of conversations and behaviors
- exposing a control and observability API

Speech recognition, text-to-speech, and AI inference are handled by a
dedicated AI client (Android + Tasker) that is part of the Charlie system
and communicates with the Pi over the network.

This separation allows Charlie to:
- evolve AI capabilities independently from hardware logic
- run reliably on constrained hardware
- be tested and developed without requiring the full AI stack


## 2. High-level architecture

### System components

Charlie consists of:
- **Raspberry Pi runtime (Node.js)**  
  Sensing, logic, state machine, orchestration, WebSocket API

- **AI client (Android + Tasker)**  
  Speech recognition, AI interaction, voice output

- **Connectivity layer**  
  Local network or WireGuard tunnel for secure communication

All components are developed as part of the same Charlie project, but are
decoupled by clear interfaces.

### Design principles

Charlie is designed to be event-driven, hardware-agnostic, and observable, with a clear separation between sensing, decision logic, and external integrations.

- Fully event-driven (no polling)
- Clear separation of concerns
- Hardware ↔ logic parity (virtual vs real hardware)
- Testable without physical hardware
- Designed for remote control and observability
- Remote-first control and debugging


### Runtime flow

```
Hardware / Virtual signals
        ↓
Drivers (hardware abstraction)
        ↓
Domain buses (presence / vibration / button)
        ↓
Domain controllers (debounce, cooldown, normalization)
        ↓
Main bus (semantic events)
        ↓
CharlieCore (state machine + rules)
        ↓
Conversation adapter (Tasker / future clients)
```

### Event buses
Each domain uses its own `EventBus`:
- `presence`
- `vibration`
- `button`
- `tasker`
- `main`

Buses can be tapped live for debugging and observability.


## 3. Operating modes

Charlie uses **activation profiles**, selected via the CLI `--mode` parameter,
to decide **which devices are active** in a given run.

- `--mode` is an arbitrary label (for example `rpi4`, `win11`, `dev`)
- devices declare which modes they are active in
- real and virtual devices may coexist
- the same configuration can be reused across machines

**Documentation**:
- [Configuration](configuration.md)


## 4. Control plane (WebSocket API)

Charlie exposes a WebSocket-based RPC API used by:
- the remote CLI
- future Web UI
- external controllers and debugging tools

This API is treated as a **stable contract**.

**Documentation**:
- [WebSocket RPC API](api/ws.md)

### Stability rules (summary)
- RPC names must not change
- Response shapes must remain compatible
- Error codes are part of the contract
- New fields may be added; existing fields must not be removed

> Internals may evolve freely.  
> The WebSocket API must remain predictable.


## 5. Quick start (development)

### Prerequisites
- Node.js (LTS)
- Git
- Yarn (Berry / v3+ via Corepack)

### Clone the repository

```bash
git clone https://github.com/<your-org-or-user>/charlie.git
cd charlie
```

### Enable Yarn (Zero-Installs)

This project uses **Yarn Zero-Installs** (dependencies are committed).

```bash
corepack enable
yarn --version
```

No `node_modules` installation step is required.

If you prefer a traditional install, you can still run `yarn install`,
but it is not required for development.


### Run the daemon with a local interactive CLI

```bash
node src/app/appRunner.js --run daemon --mode win11 --interactive --log-level info
```

This starts:
- the full Charlie runtime
- the WebSocket server
- an interactive CLI attached to the daemon

The meaning of `--mode` depends on your configuration.

See:
- [Configuration](configuration.md)
- [CLI usage](cli.md)


## 6. CLI usage

The CLI can run:
- locally (attached to the daemon process)
- remotely (via WebSocket)

A detailed CLI guide is available here:
- [CLI usage](cli.md)


## 7. Raspberry Pi setup

Production deployment on Raspberry Pi requires additional setup.

See:
- [Raspberry Pi systemd service (Charlie)](docs_old/setup/rpi-systemd)


## 8. Testing strategy

Charlie uses three complementary test layers.

### Unit tests
- Core logic
- State machine
- Rule evaluation
- CLI → WS mapping

### Integration tests
- Spawn the real `appRunner` process
- Real uWebSockets.js server (no mocks)
- Black-box WebSocket API testing
- No hardware required

### Manual / device tests
- Raspberry Pi
- Real sensors
- Real phone + Tasker


## 9. Documentation

The Charlie project is composed of multiple cooperating subsystems.
The documentation is organized to let you explore the system at different levels,
from high-level concepts to concrete implementation details.

### System & Architecture
- [System overview](system-overview.md)  
  High-level view of Charlie as a complete interactive system

- [Node.js app architecture](node-architecture.md)  
  Event-driven design, buses, controllers, core state machine, and runtime model

### Hardware & Deployment
- [Hardware](hardware.md)  
  Sensors, wiring concepts, and physical deployment considerations

- [Deployment & systemd](setup/rpi-systemd.md)
  Running Charlie as a system service on the Pi

### AI Client & Phone
- [Phone setup](phone-setup.md)  
  Android device, Tasker configuration, and AI client integration

### Configuration & Simulation
- [Configuration](configuration.md)  
  Configuration model, sensor definitions, rules, and runtime parameters

- [Simulation mode](simulation.md)  
  Virtual hardware, CLI injection, and deterministic testing

### CLI
- [CLI usage](cli.md)

### APIs
- [WebSocket API](api/ws.md)  
  Stable control and observability API used by the CLI and future Web UI

### Development

- [Development Setup (RPi Runtime)](dev-setup/README.md)
  Development and remote runtime setup instructions

## 10. Future development

Planned (not yet implemented):
- Web UI (configuration and live observability)
- Telemetry and metrics export
- WS2812 LED control
- Coordinate-based presence sensing (LD2450)
- Persistent configuration storage (SQLite)


## 11. Project philosophy

Charlie is designed to be:
- predictable to operate
- observable when something goes wrong
- safe to extend without breaking external integrations

If a change makes the system harder to reason about, it is considered a regression.
