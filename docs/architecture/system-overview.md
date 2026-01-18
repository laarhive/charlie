<!-- docs/architecture/system-overview.md -->
# System overview

Charlie is an autonomous interactive mascot. It senses the real world and triggers AI-powered voice interactions through a separate AI client.

## System components

### Charlie Core (Raspberry Pi / Node.js)
Responsibilities:
- Read devices (presence, vibration, buttons, etc.)
- Normalize device signals via domain controllers
- Run core logic (rules + state machine)
- Orchestrate conversations via an adapter
- Expose control and observability over the network (later documented separately)

### Charlie AI (Android phone + Tasker)
Responsibilities:
- Speech recognition
- AI interaction (ChatGPT Voice client)
- Voice output (speaker)
- Optional callbacks/telemetry to Charlie Core (conversation started/ended, etc.)

### Connectivity layer
A network path between Core and AI:
- Local LAN
- Optional WireGuard tunnel

Connectivity is not part of the core logic. It is an external transport used by the adapter.

### Charlie UI (future)
Not implemented yet.
Possible directions:
- Web UI over WebSocket (hosted by Core)
- Mobile app

### Charlie Cloud (future)
Not required right now.
Possible uses later:
- backups
- remote configuration
- telemetry

## High-level runtime flow

Devices (hardware or virtual)
        ↓
Device drivers
        ↓
Domain buses (presence / vibration / button / ...)
        ↓
Domain controllers (debounce, cooldown, normalization)
        ↓
Main bus (semantic events)
        ↓
Charlie Core (rules + state machine)
        ↓
Conversation adapter (Tasker / future clients)

## Replacement and decoupling

Components are replaceable as long as the interfaces remain stable:
- a device can be swapped (protocol changes) without changing controllers/core
- a controller can be swapped (normalization changes) without changing core
- the conversation adapter can be swapped without changing sensing logic
```
