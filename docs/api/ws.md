<!-- docs/api/ws.md -->
# WebSocket Bus Streaming API

Charlie exposes a **read-only WebSocket API** for streaming internal bus events.

This API is intended for:
- observability
- debugging
- live inspection
- future Web UI

It does **not** provide control or command execution.

---

## Default address

```text
ws://127.0.0.1:8787/ws
```

- Default port: **8787**
- Configurable via `config.server.port`

---

## HTTP companion page

A simple built-in bus viewer is available at:

```text
http://127.0.0.1:8787/bus.html
```

This page:
- connects to the WebSocket endpoint
- displays live bus events
- is intended for debugging and development

> Note: The viewer may be moved to a different path or replaced by a full Web UI in the future.  
> The WebSocket API itself is the stable contract.

---

## Scope and guarantees

- **Server → client only**
- No inbound messages are processed
- No state mutation
- Events reflect real internal buses
- Ordering is preserved per bus
- Filtering happens at connection time

---

## Endpoint

```text
/ws
```

---

## Bus selection (query parameters)

Bus selection is done **when opening the connection**.

```text
/ws                 → default bus (main, if available)
/ws?main&button     → subscribe to selected buses
/ws?all             → subscribe to all buses
```

Rules:
- Unknown query tokens are ignored
- If no valid bus is selected, `main` is used (if available)
- Selection cannot be changed after connection

---

## Messages

### Welcome message

Sent once on successful connection.

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

### `bus.event` (server-pushed)

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
- `bus` – bus name (`main`, `presence`, `button`, etc.)
- `event.type` – semantic or system event type
- `event.ts` – timestamp (milliseconds)
- `event.source` – emitting component
- `event.payload` – event-specific data

---

## What this API does NOT do

- ❌ No control or commands
- ❌ No CLI integration
- ❌ No RPC
- ❌ No acknowledgements
- ❌ No state changes

All control is performed locally via the interactive CLI or through SSH access to the host.

---

## Design intent

- Keep the WebSocket surface minimal and safe
- Avoid duplication of CLI or control logic
- Allow passive observers without side effects
- Enable future Web UI without breaking changes

---

## Summary

| Capability        | Supported |
|-------------------|-----------|
| Bus streaming     | ✅        |
| Bus filtering     | ✅        |
| State mutation    | ❌        |
| Command execution | ❌        |
| Bidirectional WS  | ❌        |

This API is **observational by design**.
