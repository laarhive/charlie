A) API plan (start now, expand later)

### HTTP endpoints (planned + implemented subset)

#### Tasker (simulated receiver)
* `POST /tasker/start`
* `POST /tasker/stop`

These stay available all the time. In hw mode you just won’t point your Tasker client at localhost.

#### Core introspection (planned)
* `GET /api/status` → current `core.getSnapshot()`
* `GET /api/config` → current config object

#### Remote debugging commands (planned)

* `POST /api/command` → accept commands similar to CLI (tap on/off, inject on/off, etc.)

We already have CLI parsing logic; later we can reuse the parser or add a JSON command schema.

### WebSocket endpoint (foundation now)

* `WS /ws`
Planned uses:
* stream tap events to Web UI
* stream status updates
* allow remote commands (same as CLI commands)

Later we’ll add message types and bus relays.
