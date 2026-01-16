# Project CHARLIE — GPIO Watchdog + libgpiod on Debian Trixie (Summary + Next Steps)

## Situation summary (what we did and why)

- We’re running Project CHARLIE on **Raspberry Pi 4 + Debian Trixie (arm64)**.
- We migrated away from **pigpio** (direct GPIO access) because it caused:
  - permission/mmap restrictions
  - root-only behavior
  - instability on Debian
- We standardized on **libgpiod v2** tooling (`gpiod` package) and fixed non-root access via udev:
  - `/dev/gpiochip*` is now `root:gpio 0660`
  - `charlie` is in the `gpio` group
- libgpiod CLI on Trixie uses v2 syntax: `gpiomon -c gpiochip0 17` etc.
- We attempted **node-libgpiod** to avoid spawning processes, but on Trixie:
  - system library is `libgpiod.so.3`
  - node-libgpiod/v1 bindings are not compatible (addon exports `{}` / no API)
  - so we **must stay with libgpiod CLI tools** for now unless we switch OS or write our own binding.

## Problem we solved / approach chosen

- We want to **avoid silent GPIO failure** in a street deployment without crashing/restarting the whole service.
- We implemented a **continuous loopback watchdog**:
  - Reserve two GPIO lines:
    - **outLine** (driven by gpioset)
    - **inLine** (monitored by gpiomon)
  - Physically wire them together with a jumper (same BCM numbering domain).
  - Watchdog toggles outLine continuously.
  - Watchdog monitors inLine continuously.
  - If no edges are observed within a derived stale interval → mark GPIO health **degraded**.
  - Publish health to **main bus** as `system:hardware` only on:
    - first known state
    - state change
    - error detail change
  - Expose this in `CharlieCore.getSnapshot()` under `hardware.status.gpio` / `hardware.errors.gpio`.

## IMPORTANT: Loopback pins must be reserved

- Do not use loopback pins in `sensors[].hw.line`.
- Current working loopback test: BCM **17 ↔ 27**.
- Verified manually:
  - `gpiomon -c gpiochip0 --num-events=10 27` shows edges when toggling 17 via `gpioset`.
  - `gpioset -c gpiochip0 -t 0 17=1` produces a rising+falling on GPIO27 when wired.

## Known pain points encountered

1) **Orphaned gpiomon/gpioset processes**
- When the Node app crashes (e.g. `logger.fatal is not a function`) or exits improperly, child processes can remain alive and keep GPIO lines busy.
- This causes:
  - “Device or resource busy”
  - degraded watchdog state
  - manual cleanup required (`pkill gpiomon`, etc.)

2) **Floating input when jumper removed**
- If loopback jumper is removed, input line can float and produce noise edges.
- This can prevent “stale” detection.
- Fix: set bias (software or hardware):
  - Prefer hardware: 10k pull-down on inLine
  - Or use gpiomon bias flags if available.

3) **node-libgpiod is not usable on Trixie**
- System has `libgpiod.so.3`. The binding expects earlier ABI. Addon builds but exports empty object.

## Current code artifact (paste this with this summary)

- `src/hw/gpio/gpioWatchdog.js` is implemented (see attached file in chat).

## Concrete next steps (high confidence)

### A) Wire the watchdog into runtime
1. Instantiate `GpioWatchdog` in `src/app/context.js` after `core` is created (so core can receive bus events).
2. Use loopback pins from config (recommended):
  - `config.gpio.chip` (default `gpiochip0`)
  - `config.gpio.watchdog.outLine` / `inLine` / `toggleMs`
3. Call `gpioWatchdog.start()` in `makeContext`.
4. Ensure `gpioWatchdog.dispose()` is called in `dispose()`.

Expected outcome:
- In `hw` mode, `core state` snapshot includes:
  - `hardware.status.gpio` = `ok|degraded`
  - `hardware.errors.gpio` = error string or null

### B) Ensure cleanup is reliable (prevent orphaned processes)
1. Confirm the watchdog uses `detached: true` and kills by process group:
  - `process.kill(-pid, 'SIGTERM')`
2. Ensure `#bindProcessSignals()` is only attached once (`#signalsBound` guard already exists).
3. Consider also killing process group with `SIGKILL` as a fallback if SIGTERM doesn’t stop them quickly (optional).
4. Ensure restart script kills old Node process before restarting (already done), but also consider a safety cleanup command in restart script for stuck gpiomon/gpioset (optional).

### C) Improve “jumper removed” detection
1. Add a pull-down bias to the monitored line:
  - Hardware recommended: 10k resistor from inLine to GND.
2. Optional: use libgpiod bias flags for `gpiomon` / `gpioset` if supported:
  - `--bias pull-down` (verify on this system)
3. Update the watchdog monitor spawn args to include bias if the tool supports it.

### D) Fix terminal spam vs observability
- There were earlier `[gpiomon] ... busy` spam messages.
- Correct approach:
  - Do not print raw stderr repeatedly.
  - Capture stderr and publish it only on transitions via `system:hardware`.
  - Keep logs “signal-based” (state changes only), not periodic spam.

### E) Decide on long-term direction
- Staying on Trixie means:
  - keep managed `gpiomon/gpioset` approach (reliable if process-group managed)
  - no stable native Node binding for libgpiod v2 today
- If later we want native bindings:
  - either move to a distro shipping older libgpiod ABI compatible with node-libgpiod
  - or write/choose a binding that supports libgpiod v2

## Quick troubleshooting commands (Pi)
- Kill all stuck processes:
  ```sh
  sudo pkill -f '/usr/bin/gpioset'
  sudo pkill -f '/usr/bin/gpiomon'
  ```
- Verify loopback:
  ```sh
  gpiomon -c gpiochip0 --num-events=10 27
  gpioset -c gpiochip0 -t 0 17=1
  ```
- Check library ABI:
  ```sh
  sudo ldconfig -p | grep -i libgpiod
  ```
- Verify permissions:
  ```sh
  id
  ls -la /dev/gpiochip*
  ```

## Key file context
- `src/core/eventTypes.js` includes:
  - `system.hardware = 'system:hardware'`
- `CharlieCore` listens for `eventTypes.system.hardware` and stores:
  - `#hardwareStatus[subsystem]`
  - `#hardwareErrors[subsystem]`
  - exposes under `hardware` in snapshot
- `context.js` is the integration point for watchdog startup and disposal
- `gpioWatchdog.js` owns long-running gpiomon/gpioset and publishes health transitions
