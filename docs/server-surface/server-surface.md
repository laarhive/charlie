# Server Surface, HTTP API, and WebSocket Streaming

This document explains how Charlie exposes functionality over HTTP and WebSocket,
how components are wired internally, and how to extend the server safely.

The goals are:
1. Make wiring and responsibilities explicit (with file references)
2. Make it easy to add new REST API endpoints
3. Make it easy to stream additional buses
4. Prepare cleanly for future WebSocket RPC

---

## High-level architecture

```
makeContext
  └─ makeServerSurface
       ├─ api        (commands / queries)
       └─ streamHub  (observability / streaming)
              │
        ┌─────┴─────┐
        │           │
   HttpRouter     WsRouter
        │           │
     /api/*        /ws
```

Key rules:
- **`serverSurface` defines what the outside world can see**
- **`WebServer` only wires transport (HTTP / WS)**
- **Business logic never lives in transport code**

---

## File layout

```
src/app/
  context.js
  serverSurface/
    makeServerSurface.js
    makeServerApi.js

src/transport/
  webServer.js
  http/
    httpRouter.js
    httpIo.js
  ws/
    wsRouter.js
    busStream.js
    busStreamWsClient.js
```

---

## Component responsibilities

### `makeContext` (`src/app/context.js`)
- Builds the runtime world (buses, core, deviceManager, etc.)
- Creates **one** `serverSurface`
- Creates **one** `WebServer`
- Does *not* know how HTTP or WebSocket work

This file should almost never need changes.

---

### `makeServerSurface` (`src/app/serverSurface/makeServerSurface.js`)
Defines the **server surface** — everything externally observable or callable.

It constructs and returns:
- `api` – application commands and queries (HTTP, future RPC)
- `streamHub` – shared streaming fanout (currently bus-based)
- `dispose()` – lifecycle cleanup

All new server capabilities start here.

---

### `makeServerApi` (`src/app/serverSurface/makeServerApi.js`)
Pure application facade.

Characteristics:
- no transport logic
- no uWS / HTTP / WS imports
- throws errors with `.code` for routers to map to responses

Typical methods:
- `getConfig()`
- `listDevices()`
- `blockDevice(id)`
- `taskerSimStart(body)`

---

### `WebServer` (`src/transport/webServer.js`)
Transport orchestrator.

Responsibilities:
- create `HttpRouter` and `WsRouter`
- register routes
- serve static files
- start/stop listening

It does **not** contain business logic.

---

## HTTP API

### `HttpRouter` (`src/transport/http/httpRouter.js`)
Owns **all REST endpoints**.

- Base prefix: `/api/v1`
- Dev-only endpoints under `/api/v1/dev`
- Uses `makeHttpIo()` internally
- Calls into `serverSurface.api`

#### Example endpoints

```
GET  /api/v1/status
GET  /api/v1/config
POST /api/v1/dev/tasker/start
POST /api/v1/dev/tasker/stop
POST /api/v1/dev/publish        (test hook)
```

#### Adding a new API endpoint (example: list devices)

1) Add method to the server API:
```js
// makeServerApi.js
const listDevices = () => deviceManager.list()
return { listDevices }
```

2) Expose it in the HTTP router:
```js
// httpRouter.js
app.get('/api/v1/devices', (res) => {
  http.json(res, 200, { ok: true, data: api.listDevices() })
})
```

No changes to `context` or `WebServer` are required.

---

## WebSocket API

### Endpoint

```
ws://<host>:<port>/ws
```

Default port: `8787` (configurable via `config.server.port`)

---

### Mode split (important)

The WebSocket endpoint supports **two modes**, selected at connection time:

| URL form        | Mode     | Status |
|-----------------|----------|--------|
| `/ws?…`         | stream   | ✅ supported |
| `/ws` (no query)| rpc      | 🚧 reserved / closed |

This split is enforced in `WsRouter`.

---

### Streaming semantics (read-only)

Streaming is **observational only**:
- server → client
- no inbound messages
- no commands
- no state mutation

Intended for:
- observability
- debugging
- live inspection
- future Web UI

---

### Bus selection (stream mode)

Bus selection happens **when opening the connection**:

```
/ws?main&button   → subscribe to selected buses
/ws?all           → subscribe to all buses
```

Rules:
- unknown tokens are ignored
- if no valid bus is selected, a default is resolved internally
- selection cannot be changed after connection

---

### Messages

#### Welcome message
Sent once on successful stream connection.

```json
{
  "type": "ws:welcome",
  "payload": {
    "ok": true,
    "features": {
      "streaming": true
    }
  }
}
```

---

#### `bus.event` (server-pushed)

```json
{
  "type": "bus.event",
  "payload": {
    "bus": "main",
    "event": {
      "type": "presence:enter",
      "ts": 1700000000000,
      "source": "deviceManager",
      "payload": {
        "zone": "front",
        "sensorId": "presence_front"
      }
    }
  }
}
```

Fields:
- `bus` – bus name
- `event.type` – semantic/system event type
- `event.ts` – timestamp (ms)
- `event.source` – emitting component
- `event.payload` – event-specific data

---

### `BusStream` (`src/transport/ws/busStream.js`)
Shared fanout for **bus observability**.

- subscribes at most once per bus
- fans out to multiple clients
- no transport logic
- no commands

To stream a new bus:
1. the bus must exist in `makeBuses`
2. it must implement `.subscribe(fn)`
3. clients connect with `/ws?<busName>`

No transport changes are required.

---

## Future WebSocket RPC (planned)

RPC will use:
```
/ws        (no query string)
```

Planned flow:
- `WsRouter` accepts RPC connections
- messages forwarded to `serverSurface.api`
- request/response correlation handled in WS layer

Streaming and REST APIs remain unchanged.

---

## Summary

- `serverSurface` defines exposure
- `WebServer` wires transport
- HTTP = commands & queries
- WebSocket stream = passive observability
- RPC is explicit and isolated
- `context` stays stable
