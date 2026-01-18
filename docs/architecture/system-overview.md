<!-- docs/architecture/system-overview.md -->
# System overview

Charlie is an autonomous interactive mascot.  
It senses the real world and triggers AI-powered voice interactions through a separate AI client.

## System components

### Charlie Core (Raspberry Pi / Node.js)

Responsibilities:
- Read devices (presence, vibration, buttons, etc.)
- Normalize device signals via domain controllers
- Run core logic (rules + state machine)
- Orchestrate conversations via an adapter
- Expose control and observability over the network

### Charlie AI (Android phone + Tasker)

Responsibilities:
- Speech recognition
- AI interaction (ChatGPT Voice client)
- Voice output (speaker)
- Optional callbacks / telemetry to Charlie Core

### Connectivity layer

A network path between Core and AI:
- Local LAN
- Optional WireGuard tunnel

Connectivity is external to core logic and hidden behind adapters.

### Charlie UI (future)

Not implemented yet.

Possible directions:
- Web UI over WebSocket
- Mobile app

### Charlie Cloud (future)

Not required currently.

Possible uses:
- Backups
- Remote configuration
- Telemetry

## High-level runtime flow

```
Devices (hardware or virtual)
        ↓
Device drivers
        ↓
Domain buses (presence / vibration / button)
        ↓
Domain controllers (debounce, cooldown, normalization)
        ↓
Main bus (semantic events)
        ↓
Charlie Core (rules + state machine)
        ↓
Conversation adapter (Tasker / future clients)
```

## Replacement and decoupling

Components are replaceable as long as interfaces remain stable:
- devices can change protocols without affecting controllers/core
- controllers can change logic without affecting core
- adapters can be replaced without changing sensing logic
