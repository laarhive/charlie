<!-- docs/api/ws.md -->
# WebSocket RPC API

Charlie exposes a WebSocket-based RPC API used by:
- remote CLI
- future UI
- external debugging tools

## Endpoint
```text
ws://<host>:<port>/ws
```

## Message types
- RPC request/response
- server-pushed `bus.event` for taps

## RPC protocol

Request:
```json
{
  "id": "string",
  "type": "rpc.type",
  "payload": {}
}
```

Success:
```json
{
  "id": "string",
  "ok": true,
  "type": "rpc.type",
  "payload": {}
}
```

Error:
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

## Core state & config

### `state.get`
Returns a runtime snapshot.

Request:
```json
{ "id": "1", "type": "state.get" }
```

### `config.get`
Returns the active config object.

Request:
```json
{ "id": "2", "type": "config.get" }
```

Notes:
- config includes `devices[]` (not sensors).

## Injection

### `inject.enable`
Enables semantic injection.

### `inject.disable`
Disables semantic injection.

### `inject.event`
Publishes a semantic event to a bus (usually `main`).

Payload fields:
- `bus`
- `type`
- `payload`
- `source` (optional)

## Devices

### `device.list`
Lists devices active in the current mode.

Request:
```json
{ "id": "3", "type": "device.list" }
```

Response payload:
```json
{
  "devices": [
    {
      "id": "buttonGpio1",
      "publishAs": "button1",
      "kind": "buttonEdge",
      "domain": "button",
      "state": "active",
      "started": true
    }
  ]
}
```

### `device.block`
Request:
```json
{ "id": "4", "type": "device.block", "payload": { "deviceId": "buttonGpio1" } }
```

### `device.unblock`
Request:
```json
{ "id": "5", "type": "device.unblock", "payload": { "deviceId": "buttonGpio1" } }
```

Unblock is idempotent.

### `device.inject`
Routes a generic payload to the device kind.

Request:
```json
{
  "id": "6",
  "type": "device.inject",
  "payload": {
    "deviceId": "buttonVirt1",
    "payload": "press 200"
  }
}
```

## Bus taps

### `bus.tap.start`
Request:
```json
{ "id": "7", "type": "bus.tap.start", "payload": { "bus": "main" } }
```

### `bus.tap.stop`
Request:
```json
{ "id": "8", "type": "bus.tap.stop", "payload": { "subId": "..." } }
```

### `bus.event` (server-pushed)
```json
{
  "type": "bus.event",
  "payload": {
    "subId": "main:...",
    "bus": "main",
    "event": {
      "type": "system:hardware",
      "ts": 1700000000000,
      "source": "deviceManager",
      "payload": {
        "deviceId": "buttonGpio1",
        "state": "active"
      }
    }
  }
}
```

## Error codes (non-exhaustive)
- `BAD_JSON`
- `BAD_REQUEST`
- `UNKNOWN_TYPE`
- `BUS_NOT_FOUND`
- `SUB_NOT_FOUND`
- `INJECT_DISABLED`
- `DEVICE_NOT_FOUND`
- `NOT_SUPPORTED`
- `INTERNAL_ERROR`
