<!-- docs/tasker-endpoints.md -->
# Tasker endpoints (phone side)

This document defines how the phone (Tasker) receives commands from Charlie Core and (optionally) sends telemetry back.

## Goals
- Core can trigger ChatGPT Voice start/stop
- Tasker validates a shared token header
- Tasker responds quickly
- Optional telemetry allows Core to measure session duration/turns/idle

## Network model
- Phone must be reachable from Core (LAN or WireGuard)
- Core sends HTTP POST requests to Tasker endpoints
- Use a shared secret header

## Endpoints (inbound to phone)

### POST `/tasker/start`
Required header:
- `X-Tasker-Token: <secret>`

Payload:
- `requestId` (string)
- `action` = `"start"`
- `prompt` (string)

Optional:
- `modeId`
- `openerId`
- `meta` (object)

Example:
```json
{
  "requestId": "req_1700000000000_start",
  "action": "start",
  "modeId": "mode.front.any",
  "openerId": "opener.front.any",
  "prompt": "...",
  "meta": {
    "zone": "front",
    "weekday": 1
  }
}
```

Response:
```json
{ "ok": true }
```

### POST `/tasker/stop`
Required header:
- `X-Tasker-Token: <secret>`

Payload:
- `requestId`
- `action` = `"stop"`
- `reason` (string)

Example:
```json
{
  "requestId": "req_1700000000000_stop",
  "action": "stop",
  "reason": "no_presence"
}
```

Response:
```json
{ "ok": true }
```

## Optional callbacks (phone → Core)

Core may expose endpoints for telemetry:
- `/api/conv/started`
- `/api/conv/ended`
- `/api/conv/turn` (later)
- `/api/conv/idle` (later)

These are not locked yet.
