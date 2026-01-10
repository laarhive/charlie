# Tasker Endpoint Plan (Phone Side)

This document defines how the phone (Tasker) receives commands from the Raspberry Pi and (optionally) sends telemetry back.

## Goals
- Pi can reliably trigger ChatGPT Voice start/stop
- Tasker validates a shared token header
- Tasker responds quickly to avoid Pi timeouts
- Optional telemetry allows Pi to measure duration/turns/idle

---

## 1) Network model
- Phone must be reachable from the Pi (LAN, VPN, or other routing)
- Tasker acts as an HTTP server (or receives HTTP requests via a plugin that supports inbound webhooks)
- Pi sends HTTP POST to the phone

Recommended:
- Run everything on a private LAN or VPN
- Use a shared secret header

---

## 2) Endpoints (inbound to phone)

### 2.1 POST /tasker/start
Purpose:
- Start a new conversation session
- Open ChatGPT and enter Voice mode
- Inject the provided boot prompt

#### Required header
- `X-Tasker-Token: <secret>`

If missing/wrong:
- respond 401

#### JSON payload (from Pi)
Minimum fields:
- `requestId` (string) unique per request/session
- `action` = `"start"`
- `prompt` (string) final assembled boot prompt

Optional fields (recommended):
- `modeId` (string)
- `openerId` (string)
- `meta` (object: zone, weekday, minuteOfDay, etc.)

Example:
```json
{
  "requestId": "req_1700000000000_start",
  "action": "start",
  "modeId": "mode.front.lunch",
  "openerId": "opener.front.lunch.01",
  "prompt": "....",
  "meta": {
    "zone": "front",
    "weekday": 1
  }
}
```

#### Response (from Tasker)
Tasker should respond immediately:
- status 200
- body `{ "ok": true }`

Tasker should not block the response on UI automation.

---

### 2.2 POST /tasker/stop
Purpose:
- Stop the current voice session
- Return to idle state (or home)
- Optional: clear app state

#### Required header
- `X-Tasker-Token: <secret>`

#### JSON payload (from Pi)
Minimum:
- `requestId` (string)
- `action` = `"stop"`
- `reason` (string, e.g. `no_presence`, `button`, `timeout`)

Example:
```json
{
  "requestId": "req_1700000000000_stop",
  "action": "stop",
  "reason": "no_presence"
}
```

#### Response
- status 200
- `{ "ok": true }`

---

## 3) Tasker execution flow

### 3.1 Token validation
- Read header `X-Tasker-Token`
- Compare to stored secret in Tasker variable, e.g. `%CHARLIE_TOKEN`
- If mismatch:
  - return 401
  - stop processing

---

### 3.2 Idempotency / duplicate protection
Pi may retry requests. Tasker should ignore duplicate requestIds.

Recommended Tasker variables:
- `%LAST_START_ID`
- `%LAST_STOP_ID`

Rules:
- If incoming start `requestId == %LAST_START_ID`, respond OK and stop (duplicate)
- Otherwise set `%LAST_START_ID = requestId` and proceed

Same for stop.

---

### 3.3 Start action steps (after responding)
Suggested order:
1) Wake/unlock if required (prefer “keep unlocked” in kiosk mode)
2) Ensure Bluetooth speaker connected (optional retries)
3) Launch ChatGPT app
4) Navigate to a new chat (optional but recommended to reduce drift)
5) Inject `prompt` as text (paste or input)
6) Switch to Voice mode / press microphone button
7) Optionally set a Tasker variable `%ACTIVE_SESSION_ID = requestId`

---

### 3.4 Stop action steps (after responding)
Suggested order:
1) Stop voice / exit voice UI
2) Optionally go back to ChatGPT home screen
3) Optionally force-stop ChatGPT if stability issues occur
4) Clear `%ACTIVE_SESSION_ID`

---

## 4) Optional callbacks (phone → Pi)
These are strongly recommended if you want:
- duration measurement
- idle detection
- turn counts

Pi will expose HTTP endpoints:
- POST `/api/conv/started`
- POST `/api/conv/ended`
- later `/api/conv/turn`
- later `/api/conv/idle`

---

### 4.1 POST /api/conv/started
When:
- Tasker successfully enters voice mode (or considers it started)

Payload:
```json
{
  "requestId": "req_...",
  "tsPhone": 1700000001234
}
```

---

### 4.2 POST /api/conv/ended
When:
- Tasker stops voice mode OR user session ended

Payload:
```json
{
  "requestId": "req_...",
  "tsPhone": 1700000030000,
  "reason": "stopped_by_pi|user_exit|error"
}
```

---

### 4.3 Idle detection strategies (optional)
Tasker can send idle when:
- no voice activity for X seconds (hard)
- or simpler: Pi can infer idle based on:
  - started time
  - presence still true
  - max active duration

If Tasker can detect “no output for X seconds”, send:
```json
{
  "requestId": "req_...",
  "idleMs": 30000
}
```

---

## 5) Kiosk / always-on recommendations
Since the screen is not needed:
- Keep screen off
- Keep Tasker and ChatGPT excluded from battery optimization
- Keep device plugged in

Reliability:
- Tasker watchdog: if ChatGPT not responding, restart app
- Optional daily soft restart

---

## 6) Testing with the Pi simulator
In virt/dev:
- Set `tasker.baseUrl = http://127.0.0.1:8787/tasker`
- Pi will post to the local simulated endpoints
- Use `tap tasker on` to see requests/responses

Then switch to real phone:
- Update `tasker.baseUrl` to phone IP
- Keep endpoint paths the same
