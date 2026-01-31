<!-- docs/cli.md -->
# CLI

Charlie provides a **local interactive CLI** that runs **inside the daemon process**.

Remote usage is done via **SSH + tmux**, preserving the exact same CLI behavior.

---

## Modes of operation

Charlie always runs as a daemon.  
The CLI is **optional** and enabled with `--interactive`.

---

### 1. Daemon only (no CLI)

Use this for:
- systemd services
- headless production runs
- unattended operation

```bash
node src/app/appRunner.js --mode rpi4
```

The process:
- loads config
- starts devices and core
- starts web server (bus streaming, APIs)
- **does not attach stdin/stdout**

---

### 2. Interactive daemon (CLI enabled)

Use this for:
- local development
- Windows usage
- debugging on Linux

```bash
node src/app/appRunner.js --mode rpi4 --interactive
```

This starts:
- the full daemon
- **plus an interactive CLI on stdin/stdout**

You get:
- readline UX
- tab completion
- prompt state (inject on/off)
- local-only commands (clock, config reload)

---

## Remote usage (Linux / Raspberry Pi)

There is **no remote CLI protocol**.

Remote control is done by running the daemon **inside an SSH session**.

### Recommended: SSH + tmux

This provides:
- a persistent interactive CLI
- reconnection after SSH drops
- identical behavior to local usage

#### Example workflow

```bash
ssh pi@rpi4
tmux new -s charlie
node src/app/appRunner.js --mode rpi4 --interactive
```

Detach:
```
Ctrl-b d
```

Reattach later:
```bash
tmux attach -t charlie
```

The CLI state (prompt, history, completion) is preserved.

---

## Windows usage

On Windows:
- always run interactively
- typically from CMD, PowerShell, or WebStorm

```bash
node src/app/appRunner.js --mode virt --interactive
```

---

## CLI usage

The CLI is **self-documenting**.

### Getting help
```
help
```

Always shows the current, authoritative command list.

---

### Example commands

Inspect state:
```
core state
device list
```

Enable semantic injection:
```
inject on
inject status
```

Simulate events:
```
presence front on
vibration high
button short
```

Device testing:
```
device inject buttonVirt1 press 200
```

Local-only (when interactive):
```
clock now
config load defaultConfig.json5
```

For the full and up-to-date command list, **use `help` inside the CLI**.

---

## Design notes

- The CLI runs **in-process**
- stdin/stdout is the only control surface
- No network transport is involved
- SSH + tmux provides remote access without duplication

This guarantees:
- identical local and remote behavior
- minimal architecture
- no drift between documentation and implementation

WebSocket RPC (for Web UI) is a **separate concern** and does not affect the CLI.
