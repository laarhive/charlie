<!-- docs/cli.md -->
# CLI

The CLI can run locally (interactive) or remotely (WebSocket).

## Process roles

### `--run daemon`
Starts the runtime:
- loads config
- activates devices for `--mode`
- starts core
- exposes WebSocket API

### `--run cli`
Starts a WS CLI client that connects to a running daemon.

## Local vs remote

### Local CLI (`--interactive`)
Example:
```bash
node src/app/appRunner.js --run daemon --mode win11 --interactive
```

Local-only features:
- clock control (`clock ...`)
- config reload (`config load ...`)

### Remote CLI (`--run cli`)
Example:
```bash
node src/app/appRunner.js --run cli --host 127.0.0.1 --port 8787
```

Remote limitations:
- no config load from disk
- no local clock manipulation

## Activation profile (`--mode`)

`--mode` selects an activation profile (e.g. `rpi4`, `win11`).

A device is loaded only if `device.modes` includes the current mode.

## Command categories

### 1) Observability
Examples:
```
tap main on
tap all status
core state
device list
```

### 2) Semantic injection (core testing)
Publishes semantic events directly to main bus. Gated by `inject on|off`.

Examples:
```
inject on
presence front on
vibration high
button short
```

Semantic injection uses `coreRole` from `config.core.injectDefaults`.

### 3) Device injection (device testing / virtual control)
Routes a generic payload to a device kind.

Examples:
```
device inject buttonVirt1 press 200
device inject buttonVirt1 {"type":"press","ms":200}
```

Devices decide how to interpret the payload.

## Device commands

- `device list`
- `device block <deviceId>`
- `device unblock <deviceId>`
- `device inject <deviceId> <payload...>`
