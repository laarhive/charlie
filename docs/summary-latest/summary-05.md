# Project CHARLIE — Runtime Status & Development Context (UPDATED)

This document is a **handoff / continuation summary** meant to be pasted into a new chat when continuing development on Project CHARLIE.  
It reflects the **current state of the project**, what was completed in this iteration, and where work should continue next.

---

## Project overview (where we are)

Project CHARLIE is a **headless, event-driven Node.js system** running on a **Raspberry Pi 4 (Debian Trixie, arm64)**.  
It is designed to operate autonomously in a street-deployed environment and integrates:

- hardware sensors (presence, vibration, buttons, GPIO)
- a robust internal event bus
- a CLI and WebSocket API
- Android/Tasker integration for voice interaction
- strong crash-recovery and observability guarantees

The Pi is treated strictly as a **runtime target**.  
All development happens remotely (WebStorm + SSH).

---

## What was completed in this iteration

### 1) GPIO subsystem overhaul (high level)

- **pigpio was fully removed**
  - caused root-only behavior, mmap issues, instability on Debian
- Replaced with a **custom GPIO abstraction built on libgpiod v2 CLI tools**
  - `gpiomon`
  - `gpioset`
  - `gpioinfo`
- Non-root GPIO access fixed via:
  - `gpio` group
  - udev rules (`/dev/gpiochip* → root:gpio 0660`)
- GPIO is now:
  - non-root
  - crash-resilient
  - deterministic
  - production-safe

⚠️ **Details of the GPIO library are intentionally not duplicated here**.  
When GPIO work is needed, a separate **GPIO context summary** should be pasted instead.

---

### 2) GPIO Watchdog implemented and validated

- Implemented a **continuous loopback watchdog** using the new GPIO abstraction.
- Uses **two reserved GPIO lines** wired together:
  - `outLine` → output (toggled periodically)
  - `inLine` → input (edge monitored)
- Behavior:
  - Toggles output every `toggleMs`
  - Resets a stale timer on every observed edge
  - If no edge within `staleMs` → watchdog degrades
- Publishes health via the main event bus:
  - `eventTypes.system.hardware`
  - subsystem: `gpio`
  - status: `ok | degraded`
  - error + errorCode only on transitions

The watchdog:
- does **not** crash the app
- does **not** spam logs
- detects GPIO failure, stuck lines, broken wiring, orphaned processes

---

### 3) GPIO process lifecycle & recovery solved

Major issues encountered and fixed:

- **Orphaned `gpiomon` / `gpioset` processes**
  - previously caused `Device or resource busy`
  - now handled via:
    - process groups
    - deterministic cleanup on exit / SIGINT / SIGTERM
- Optional **auto-reclaim mechanism**:
  - Uses consumer tags
  - Reclaims only lines owned by *this application*
  - Safe across restarts and crashes
- Output GPIOs use a **hog model**:
  - HIGH = `gpioset` process running
  - LOW = process killed (line released)
  - no toggle flags (`-t`) used

---

### 4) Documentation added / updated

New or updated docs now exist for:

- GPIO setup on Debian Trixie (libgpiod)
- Remote development workflow (Pi as runtime target)
- Deployment checklist (updated for libgpiod, watchdog, non-root GPIO)

These are **separate, copy-safe Markdown files** intended for the repository.

---

## Current state of the codebase (important)

### GPIO
- Fully custom abstraction
- Stable and validated on RPi4 + Debian Trixie
- Used by watchdog
- Ready for reuse by sensors, buttons, LEDs, etc.
- Details intentionally omitted here (provide GPIO summary when needed)

### Watchdog
- File: `src/hw/gpio/gpioWatchdog.js`
- Integrated with:
  - event bus
  - logger
  - core hardware status tracking
- Uses only the public GPIO API

### Core integration
- `eventTypes.system.hardware` already exists
- `CharlieCore`:
  - tracks `hardware.status[subsystem]`
  - tracks `hardware.errors[subsystem]`
  - exposes both in `getSnapshot()`
- Watchdog publishes transitions only (no spam)

---

## What has NOT changed

- Overall event-driven architecture
- Domain buses, controllers, drivers
- CLI and WebSocket RPC model
- Android / Tasker integration plan
- Virt vs HW mode separation
- Test strategy (unit + integration)

---

## Known constraints (accepted)

- `node-libgpiod` is **not usable on Debian Trixie**
  - system ships `libgpiod.so.3`
  - available Node bindings target older ABI
- Until:
  - OS changes, or
  - a libgpiod v2 binding exists, or
  - a custom native addon is written  
    → CLI tools are the correct and stable choice.

---

## Where to continue next (high-confidence)

### A) Reuse GPIO for sensors & actuators
- Buttons
- Reed switches
- LEDs
- Simple digital sensors
  (Provide GPIO context summary when starting that work.)

### B) Finalize watchdog integration
- Ensure it is instantiated and disposed from `context.js`
- Confirm loopback pins are **reserved** in config
- Ensure bias / pull-down is applied (hardware preferred)

### C) Harden systemd deployment
- Confirm clean shutdown releases GPIO
- Verify restart behavior under crash conditions
- Optional: watchdog health surfaced in external monitoring

### D) Move forward with remaining hardware drivers
- Presence sensors
- Vibration
- Button gesture logic
- All can now rely on the same GPIO backend

---

## Mental model to keep in mind

- GPIO is **process-owned**, not value-owned
- Stability comes from managing **process lifecycle**, not registers
- Health is a **signal**, not a crash condition
- Charlie should degrade gracefully, not restart blindly
- Everything publishes into the bus; the core decides what matters

---

## Status

✅ GPIO subsystem: **done, stable, production-ready**  
✅ Watchdog: **done, validated, integrated**  
✅ Docs: **updated**  
➡️ Ready to continue with **sensor drivers and higher-level behavior**

---
