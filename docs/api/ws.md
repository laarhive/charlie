<!-- docs/api/ws.md -->
# WebSocket API

Charlie exposes two WebSocket endpoints:

- **RPC** (`/rpc`) for request/response control
- **Stream** (`/ws`) for server-pushed bus events

Used by:
- remote CLI
- future Web UI
- external debugging tools

---

## Endpoints

```text
ws://<host>:<port>/rpc
ws://<host>:<port>/ws
```

---

## RPC (`/rpc`)

### Protocol

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

### Core

#### `state.get`
Returns a runtime snapshot.

```json
{ "id": "1", "type": "state.get" }
```

#### `config.get`
Returns the active config object.

```json
{ "id": "2", "type": "config.get" }
```

### Injection

#### `inject.enable`
Enables semantic injection.

#### `inject.disable`
Disables semantic injection.

#### `inject.event`
Publishes a semantic event to a bus (usually `main`).

Payload:
- `bus`
- `type`
- `payload`
- `source` (optional)

```json
{
  "id": "3",
  "type": "inject.event",
  "payload": {
    "bus": "main",
    "type": "presence:enter",
    "payload": { "zone": "front" },
    "source": "cli"
  }
}
```

### Devices

#### `device.list`
Lists devices active in the current mode.

```json
{ "id": "4", "type": "device.list" }
```

Example response payload:
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

#### `device.block`
```json
{ "id": "5", "type": "device.block", "payload": { "deviceId": "buttonGpio1" } }
```

#### `device.unblock`
Unblock is idempotent.

```json
{ "id": "6", "type": "device.unblock", "payload": { "deviceId": "buttonGpio1" } }
```

#### `device.inject`
Routes a generic payload to the device kind.

```json
{
  "id": "7",
  "type": "device.inject",
  "payload": {
    "deviceId": "buttonVirt1",
    "payload": "press 200"
  }
}
```

---

## Stream (`/ws`)

### Bus selection (query params)

Select buses at connect time:

```text
/ws               -> default: main
/ws?main&button   -> selected buses
/ws?all           -> all buses
```

Rules:
- Unknown params are ignored
- If no valid bus is selected, defaults to `main` (if available)

### `bus.event` (server-pushed)

```json
{
  "type": "bus.event",
  "payload": {
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

---

## Error codes (non-exhaustive)

- `BAD_JSON`
- `BAD_REQUEST`
- `UNKNOWN_TYPE`
- `INJECT_DISABLED`
- `DEVICE_NOT_FOUND`
- `NOT_SUPPORTED`
- `INTERNAL_ERROR`
