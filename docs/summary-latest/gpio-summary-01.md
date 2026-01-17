# Project CHARLIE — GPIO Library (libgpiod-based) — CONTEXT SUMMARY

This project uses a **custom GPIO abstraction built on libgpiod v2 CLI tools** (`gpiomon`, `gpioset`, `gpioinfo`) instead of pigpio.

The design goal is:
- non-root GPIO access
- deterministic behavior on Debian Trixie / Bookworm
- process-safe GPIO ownership
- crash recovery and watchdog support
- pigpio-like developer ergonomics (events + digitalWrite)

This summary explains **how the GPIO library works and how to use it correctly**.

---

## High-level architecture

The GPIO stack consists of three layers:

1. **GpioBackend**
  - Owns the GPIO chip (`gpiochip0`)
  - Manages binaries (`gpiomon`, `gpioset`, `gpioinfo`)
  - Tracks active GPIO lines
  - Handles cleanup on process exit
  - Optional: auto-reclaim busy GPIO lines using consumer tags

2. **Gpio (public API)**
  - One instance per GPIO line
  - Exposes a pigpio-like interface:
    - `digitalWrite(level)`
    - `.on('interrupt', handler)`
    - `.on('edge', handler)`
  - Automatically starts/stops monitors based on listeners
  - Delegates all heavy lifting to the backend

3. **GpioWatchdog (consumer of Gpio)**
  - Uses two GPIO lines wired together
  - Toggles one line periodically
  - Listens for edges on the other
  - Publishes `system:hardware` health events
  - Detects stale GPIO behavior and failures

---

## Why libgpiod CLI (not pigpio)

- pigpio requires root or daemon access
- pigpio is unstable / deprecated on newer Debian
- libgpiod v2 is the kernel-native GPIO interface
- CLI tools are stable and auditable
- Process lifecycle maps cleanly to GPIO ownership

---

## Consumer tags & ownership model

Every GPIO operation may optionally set a **consumer tag**:

```
<consumerTag>:<role>:<line>
```

Examples:
- `charlie:hog:17`  → output holder
- `charlie:mon:17`  → edge monitor

### Purpose
- Identify which process owns a GPIO line
- Detect stale ownership from crashed processes
- Allow safe auto-reclaim of *our own* GPIO lines only

### Important rules
- `consumerTag` is **NOT defaulted**
- If you want reclaim behavior, you **must** provide `consumerTag`
- Without `consumerTag`, no `-C` flag is passed to CLI tools
- Reclaim is **opt-in** via `reclaimOnBusy`

---

## Auto-reclaim behavior (optional)

When enabled:
- If `gpioset` fails with **“Device or resource busy”**
- The backend checks `gpioinfo` for the current consumer
- If the consumer starts with our `consumerTag`:
  - The backend kills **only** matching consumers for that line:
    - `<consumerTag>:hog:<line>`
    - `<consumerTag>:mon:<line>`
- Then retries once

This allows recovery from:
- crashes
- SIGKILL
- previous app instances
- orphaned CLI processes

It will **never kill foreign GPIO users**.

---

## How a GPIO line behaves

### Output (`digitalWrite`)

- `digitalWrite(1)`
  - Starts a `gpioset` process that **hogs the line HIGH**
  - Process stays alive while HIGH
- `digitalWrite(0)`
  - Kills the hog process
  - Line is released (LOW / floating depending on hardware)

No toggling flags are used (`-t` is NOT used).

This avoids:
- busy errors
- transient pulses
- unexpected release timing

---

### Input (edge monitoring)

- Monitoring uses `gpiomon`
- The monitor process:
  - Starts **only when** an event listener is attached
  - Stops automatically when the last listener is removed
- Supported options:
  - pull-up / pull-down bias
  - rising / falling / either edge

Events emitted:
- `'interrupt'`
- `'edge'`

Payload:
```js
{
  level: 0 | 1 | 2,   // 2 = unknown
  tick: uint32,
  raw: string        // raw gpiomon output line
}
```

---

## Public API (how YOU use it)

### Creating a GPIO line

```js
import Gpio from './gpio.js'

const led = new Gpio(17, {
  mode: Gpio.OUTPUT,
  consumerTag: 'charlie',
  reclaimOnBusy: true,
})
```

```js
const button = new Gpio(4, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PULL_DOWN,
  edge: Gpio.EITHER_EDGE,
  consumerTag: 'charlie',
})
```

---

### Writing output

```js
led.digitalWrite(1)  // HIGH (hog process starts)
led.digitalWrite(0)  // LOW  (hog process stops)
```

---

### Listening for input events

```js
button.on('interrupt', ({ level, tick }) => {
  console.log('Button level:', level)
})
```

Listeners automatically manage `gpiomon` lifecycle.

---

### Cleanup (important)

```js
led.dispose()
button.dispose()
```

- Stops monitors
- Releases hogged outputs
- Prevents orphaned processes

Backend also cleans up automatically on:
- `SIGINT`
- `SIGTERM`
- normal process exit

---

## GPIO Watchdog (how it works)

- Uses two GPIO lines wired together
- Example:
  - outLine: GPIO17
  - inLine:  GPIO27
- Periodically toggles output
- Resets a stale timer on every observed edge
- If no edge arrives within `staleMs`:
  - publishes `system:hardware` with `status: degraded`

This detects:
- GPIO subsystem failure
- stuck lines
- orphaned hogs
- broken wiring

The watchdog **only uses the public Gpio API**, proving the abstraction is correct.

---

## What NOT to do

- Do not mix pigpio with this system
- Do not reuse watchdog loopback pins for sensors
- Do not rely on implicit GPIO cleanup without `dispose`
- Do not enable reclaim without a consumerTag
- Do not assume gpioset keeps state after exit

---

## Mental model (important)

- **Processes own GPIO, not values**
- GPIO state = “who is holding the line”
- The library manages *processes*, not registers
- Consumer tags define **ownership domains**
- Recovery is intentional, explicit, and safe

---

## Status

- Stable on Debian Trixie / Raspberry Pi 4
- Non-root
- Crash-resilient
- Production-ready
- Designed for long-running unattended systems
