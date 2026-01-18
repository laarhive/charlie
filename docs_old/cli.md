# CLI Usage

Charlie provides a **command-line interface (CLI)** for control, debugging, and testing.
The CLI can run **locally** (attached to the daemon) or **remotely** (over WebSocket).

This document explains:
- how to start Charlie and the CLI
- the difference between local and remote CLI
- the two testing mechanisms: *semantic injection* vs *virtual hardware*

---

## 1. Process roles (`--run`)

Charlie supports two process roles, selected via `--run`:

### `--run daemon`
Starts the **Charlie runtime**:
- loads configuration
- activates sensors based on `--mode`
- runs the core state machine
- exposes the WebSocket API

By default, the daemon is **headless** (no stdin/stdout interaction).

### `--run cli`
Starts a **CLI client** that connects to a running daemon via WebSocket.

This mode:
- does not load configuration
- does not require `--mode`
- only acts as a controller/observer

---

## 2. Local vs remote CLI

### Local CLI (`--interactive`)

When running the daemon, you may attach a **local interactive CLI**:

```bash
node src/app/appRunner.js --run daemon --mode win11 --interactive
```

This:
- runs the daemon
- attaches a CLI to the same process
- is useful for development and debugging

Local CLI features:
- full command set
- clock control
- virtual hardware control
- config reload

---

### Remote CLI (`--run cli`)

You can attach a CLI to an already running daemon:

```bash
node src/app/appRunner.js --run cli --host 127.0.0.1 --port 8787
```

This:
- connects over WebSocket
- works locally or over the network (e.g. WireGuard)
- does **not** require access to the filesystem

Remote CLI limitations:
- no config loading from disk
- no local clock manipulation
- no virtual hardware control

---

## 3. Activation profile (`--mode`)

The `--mode` flag selects an **activation profile**.

```bash
node src/app/appRunner.js --run daemon --mode rpi4
```

- `--mode` is **required** for `--run daemon`
- it determines which sensors are active
- values are arbitrary strings (`rpi4`, `win11`, `dev`, etc.)
- sensors declare which modes they are active in

See:
- [Configuration](configuration.md)

---

## 4. CLI command categories

CLI commands fall into **three distinct categories**.

Understanding the difference is critical.

---

### 4.1 Observability & control

These commands inspect or control the running system:

Examples:
```
tap main on
tap all status
core state
driver list
driver disable button1
```

They:
- do not modify sensor signals
- are always safe to use
- work in both local and remote CLI

---

### 4.2 Semantic injection (core testing)

Semantic injection **bypasses hardware and domain logic** and injects events
directly into the **main bus**.

Examples:
```
button short
presence front on
vibration high
```

Properties:
- skips drivers and domain controllers
- intended for fast rule / core testing
- guarded by `inject on|off`
- works in both local and remote CLI

This answers:
> “What would Charlie do *if* this event happened?”

---

### 4.3 Virtual hardware control (full pipeline testing)

Virtual hardware simulates **real sensors**, exercising the full pipeline:
drivers → domain controllers → core.

Examples:
```
virt list
virt press buttonVirt1 200
```

Properties:
- drives virtual signals defined in config
- publishes raw domain events (e.g. `buttonRaw:edge`)
- respects debounce, cooldown, timing
- **local CLI only**

This answers:
> “What happens when a real device behaves like this?”

---

## 5. `inject` vs `virt` (important distinction)

| Mechanism | Scope | Purpose |
|--------|------|--------|
| `inject` | Main bus | Fast semantic testing |
| `virt` | Hardware layer | End-to-end realism |

They are **not interchangeable** and are intentionally separate.

---

## 6. Safety defaults

- Injection is **disabled by default**
- Virtual hardware is only available in local CLI
- Daemon is headless by default
- No command silently mutates hardware state

These constraints are deliberate.

---

## 7. Summary

- `--run` decides *what process runs*
- `--interactive` decides *whether stdin/stdout is attached*
- `--mode` decides *which devices are active*
- `inject` tests **logic**
- `virt` tests **hardware + logic**

If a test feels ambiguous, the abstraction is wrong.

Charlie’s CLI is designed to make testing **explicit and predictable**.
