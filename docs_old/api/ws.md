# WebSocket RPC API

Charlie exposes a WebSocket-based RPC API used by:
- the remote CLI
- future Web UI
- external controllers and debugging tools

This API is treated as a **stable contract**.

---

## Endpoint

```
ws://<host>:<port>/ws
```

- Default port is typically `8787` (configurable).
- In production you may bind to `127.0.0.1` and access via SSH tunnel or reverse proxy.

---

## Message types

Charlie uses two message types over the same WebSocket connection:

1) **RPC request/response** (client → server → client)
2) **Server-pushed events** for taps (`bus.event`)

Each WebSocket connection maintains its own tap subscriptions.

---

## Connection lifecycle

### Server welcome
Upon connection, the server sends:

```json
{
  "type": "ws:welcome",
  "payload": {
    "ok": true,
    "features": {
      "rpc": true,
      "taps": true
    }
  }
}
```

---

## RPC protocol

### Request format
```json
{
  "id": "string",
  "type": "rpc.type",
  "payload": {}
}
```

- `id` is chosen by the client and must be unique per request.
- `type` identifies the RPC operation.
- `payload` is optional and depends on the operation.

### Success response
```json
{
  "id": "string",
  "ok": true,
  "type": "rpc.type",
  "payload": {}
}
```

### Error response
```json
{
  "id": "string",
  "ok": false,
  "type": "rpc.type",
  "error": {
    "message": "human_readable_message",
    "code": "ERROR_CODE"
  }
}
```

---

## Core state & config

### `state.get`
Returns a snapshot of the current runtime state.

**Request**
```json
{ "id": "1", "type": "state.get" }
```

**Response**
```json
{
  "id": "1",
  "ok": true,
  "type": "state.get",
  "payload": {
    "state": "IDLE",
    "injectEnabled": false
  }
}
```

Notes:
- Payload includes everything returned by `CharlieCore.getSnapshot()`.
- If enabled, it may also include `injectEnabled` from the control layer.

---

### `config.get`
Returns the active runtime configuration.

**Request**
```json
{ "id": "2", "type": "config.get" }
```

**Response**
```json
{
  "id": "2",
  "ok": true,
  "type": "config.get",
  "payload": {
    "server": { "port": 8787 },
    "sensors": []
  }
}
```

---

## Injection control

Injection is explicitly guarded. Most deployments keep injection disabled unless actively debugging.

### `inject.enable`
Enables injection.

**Request**
```json
{ "id": "3", "type": "inject.enable" }
```

**Response**
```json
{
  "id": "3",
  "ok": true,
  "type": "inject.enable",
  "payload": {
    "injectEnabled": true
  }
}
```

---

### `inject.disable`
Disables injection.

**Request**
```json
{ "id": "4", "type": "inject.disable" }
```

**Response**
```json
{
  "id": "4",
  "ok": true,
  "type": "inject.disable",
  "payload": {
    "injectEnabled": false
  }
}
```

---

### `inject.event`
Publishes a semantic event to a target bus.

**Request**
```json
{
  "id": "5",
  "type": "inject.event",
  "payload": {
    "bus": "main",
    "type": "presence:enter",
    "source": "webui",
    "payload": {
      "zone": "front",
      "sensorId": "presence_front"
    }
  }
}
```

**Success response**
```json
{
  "id": "5",
  "ok": true,
  "type": "inject.event",
  "payload": { "ok": true }
}
```

**Errors**
- `INJECT_DISABLED`
- `BUS_NOT_FOUND`

---

## Driver management

Drivers can be toggled at runtime (publishing on/off) via `setEnabled()`.

### `driver.list`
Returns known drivers and their runtime status.

**Request**
```json
{ "id": "6", "type": "driver.list" }
```

**Response**
```json
{
  "id": "6",
  "ok": true,
  "type": "driver.list",
  "payload": {
    "drivers": [
      {
        "id": "presence_front",
        "role": "presence",
        "type": "ld2410",
        "bus": "presence",
        "enabled": true,
        "started": true
      }
    ]
  }
}
```

---

### `driver.enable`
Enables publishing for a driver.

**Request**
```json
{
  "id": "7",
  "type": "driver.enable",
  "payload": { "sensorId": "presence_front" }
}
```

---

### `driver.disable`
Disables publishing for a driver.

**Request**
```json
{
  "id": "8",
  "type": "driver.disable",
  "payload": { "sensorId": "presence_front" }
}
```

**Errors**
- `DRIVER_NOT_FOUND`
- `NOT_SUPPORTED`

---

## Bus taps (live event streaming)

Bus taps allow a client to subscribe to live events published on any bus.

### `bus.tap.start`

**Request**
```json
{
  "id": "9",
  "type": "bus.tap.start",
  "payload": {
    "bus": "main",
    "filter": {
      "typePrefix": "presence:"
    }
  }
}
```

**Response**
```json
{
  "id": "9",
  "ok": true,
  "type": "bus.tap.start",
  "payload": {
    "subId": "main:1699999999:abc123"
  }
}
```

---

### `bus.tap.stop`

**Request**
```json
{
  "id": "10",
  "type": "bus.tap.stop",
  "payload": {
    "subId": "main:1699999999:abc123"
  }
}
```

**Response**
```json
{
  "id": "10",
  "ok": true,
  "type": "bus.tap.stop",
  "payload": {
    "ok": true
  }
}
```

---

### `bus.event` (server-pushed)

Delivered asynchronously when a tap subscription is active:

```json
{
  "type": "bus.event",
  "payload": {
    "subId": "main:1699999999:abc123",
    "bus": "main",
    "event": {
      "type": "presence:enter",
      "ts": 1699999999123,
      "source": "ld2410Driver",
      "payload": {
        "zone": "front",
        "sensorId": "presence_front"
      }
    }
  }
}
```

Notes:
- `bus.event` messages are not correlated to an RPC `id`.
- Subscriptions are per WebSocket connection.

---

## Error codes

Non-exhaustive list:

- `BAD_JSON`
- `BAD_REQUEST`
- `UNKNOWN_TYPE`
- `BUS_NOT_FOUND`
- `SUB_NOT_FOUND`
- `INJECT_DISABLED`
- `DRIVER_NOT_FOUND`
- `NOT_SUPPORTED`
- `INTERNAL_ERROR`

---

## Stability rules

- RPC names must not change.
- Response shape must remain consistent.
- Error codes are part of the contract.
- New fields may be added; existing fields must not be removed.

If WS contract tests fail, treat it as a breaking API change.
