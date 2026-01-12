# Project CHARLIE

**Charlie** is an outdoor restaurant mascot that detects people near the entrance, initiates voice conversations, and guides interactions in a friendly, human way. The Raspberry Pi handles sensing + decision logic. A phone handles voice (ChatGPT Voice) via Tasker automation.

---

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

---

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

---

## 3. Operating modes

### Virtual mode (`virt`)
- Uses virtual signals instead of physical hardware
- Full pipeline active (drivers → controllers → core)
- Safe to run on any machine
- Intended for:
  - development
  - testing
  - CI

### Hardware mode (`hw`)
- Uses real GPIO / serial drivers
- Intended for Raspberry Pi deployment
- CLI injection disabled by default

---

## 4. Control plane (WebSocket API)

Charlie exposes a WebSocket-based RPC API used by:
- the remote CLI
- future Web UI
- external controllers and debugging tools

This API is treated as a **stable contract**.

📄 **Documentation**:
- [WebSocket RPC API](docs/api/ws.md)

### Stability rules (summary)
- RPC names must not change
- Response shapes must remain compatible
- Error codes are part of the contract
- New fields may be added; existing fields must not be removed

> Internals may evolve freely.  
> The WebSocket API must remain predictable.

---

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


### Run in virtual hardware mode with CLI

```bash
node src/app/appRunner.js --mode virt --cli --log-level info
```

This starts:
- the full Charlie runtime
- virtual hardware drivers
- the WebSocket server
- an interactive CLI attached to the daemon

---

## 6. CLI usage

The CLI can run:
- locally (attached at startup)
- remotely (via WebSocket)

Capabilities include:
- enabling/disabling bus taps
- inspecting core state and configuration
- listing and toggling drivers
- enabling/disabling injection
- injecting semantic events (guarded)
- controlling the runtime clock (freeze / advance)

Tab completion is context-aware.

---

## 7. Raspberry Pi setup

Production deployment on Raspberry Pi requires additional setup.

See:
- [Raspberry Pi GPIO setup (pigpio)](docs/setup/raspberry-pi-gpio.md)
- [Raspberry Pi systemd service (Charlie)](docs/setup/raspberry-pi-systemd)

---

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

---

## 9. Documentation

The Charlie project is composed of multiple cooperating subsystems.
The documentation is organized to let you explore the system at different levels,
from high-level concepts to concrete implementation details.

### System & Architecture
- [System overview](docs/system-overview.md)  
  High-level view of Charlie as a complete interactive system

- [Node.js app architecture](docs/node-architecture.md)  
  Event-driven design, buses, controllers, core state machine, and runtime model

### Hardware & Deployment
- [Hardware](docs/hardware.md)  
  Sensors, wiring concepts, and physical deployment considerations

- [Raspberry Pi GPIO setup (pigpio)](docs/setup/raspberry-pi-gpio.md)  
  GPIO backend setup and system integration on Raspberry Pi

- [Deployment & systemd](docs/setup/raspberry-pi-systemd.md)
  Running Charlie as a system service on the Pi

### AI Client & Phone
- [Phone setup](docs/phone-setup.md)  
  Android device, Tasker configuration, and AI client integration

### Configuration & Simulation
- [Configuration](docs/configuration.md)  
  Configuration model, sensor definitions, rules, and runtime parameters

- [Simulation mode](docs/simulation.md)  
  Virtual hardware, CLI injection, and deterministic testing

### APIs
- [WebSocket API](docs/api/ws.md)  
  Stable control and observability API used by the CLI and future Web UI


## 10. Future development

Planned (not yet implemented):
- Web UI (configuration and live observability)
- Telemetry and metrics export
- WS2812 LED control
- Coordinate-based presence sensing (LD2450)
- Persistent configuration storage (SQLite)

---

## 11. Project philosophy

Charlie is designed to be:
- predictable to operate
- observable when something goes wrong
- safe to extend without breaking external integrations

If a change makes the system harder to reason about, it is considered a regression.
