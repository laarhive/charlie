# Project CHARLIE — Handoff Summary
**Topic:** Virtual hardware normalization → GPIO push button driver (real hardware)

This document is a **handoff / continuation summary** meant to be pasted into a new chat when continuing development on **Project CHARLIE**.  
It captures the **current state**, **key decisions**, and **exact next steps**, with a checklist of files to paste so work can continue seamlessly.

---

## Where the project is now

Charlie is an **event-driven Node.js runtime** built around clear separation of concerns:

- **Drivers** publish raw-ish events to domain buses
- **Domain controllers** normalize raw signals into semantic events
- **CharlieCore** consumes semantic events from the main bus
- **CLI** provides observability, control, and testing hooks

### Event flow (button example)

```
Signal (GPIO / Virtual)
        ↓
GpioButtonDriver
        ↓
button bus (buttonRaw:edge)
        ↓
EdgeButtonController
        ↓
main bus (button:press)
        ↓
CharlieCore
```

---

## Key architectural decisions (locked in)

### 1) No global “virt vs hw” runtime mode

Charlie does **not** run in a global hardware mode.

Instead:
- `--mode <profile>` is an **activation profile** (e.g. `rpi4`, `win11`, `dev`)
- Each device declares:
  - `enabled: true|false`
  - `modes: ['rpi4', 'win11', ...]`
- A device is active **iff**:
  - `enabled === true`
  - `modes.includes(currentMode)`

This allows:
- one config file across machines
- mixing real + virtual devices
- no branching logic in core or controllers

---

### 2) Virtual and real hardware are architecturally identical

After activation:
- virtual devices
- GPIO devices
- future USB / serial devices

are treated **identically**.

The distinction exists **only** in `sensor.hw`:
- `hw.gpio`
- `hw.virtual`
- `hw.serial` (future)

---

### 3) Two testing mechanisms exist — and must remain distinct

#### A) Semantic injection (core testing)

Examples:
```
button short
presence front on
```

- inject **semantic events** directly into the **main bus**
- bypass drivers and domain controllers
- used for fast rule / state-machine testing

#### B) Virtual hardware control (full pipeline testing)

Example:
```
virt press buttonVirt1 200
```

- drives a **virtual signal**
- exercises drivers → domain controllers → core
- mirrors real hardware behavior

These are **not interchangeable** and should not be conflated.

---

### 4) Logical button identity via `publishAs`

Multiple devices may publish as the **same logical sensor**.

Example:
```
{
  id: 'button_gpio',
  publishAs: 'button1',
  modes: ['rpi4'],
  hw: { gpio: { chip: 'gpiochip0', line: 24 } }
}

{
  id: 'button_virtual',
  publishAs: 'button1',
  modes: ['win11'],
  hw: { virtual: { initial: false } }
}
```

Both produce events with:
```
payload.sensorId === 'button1'
```

The rest of the system is unaware of which one fired.

---

### 5) Button pipeline status

- `GpioButtonDriver`
  - subscribes to a binary signal
  - publishes `buttonRaw:edge` to **button bus**
- `EdgeButtonController`
  - listens on **button bus**
  - applies cooldown
  - publishes `button:press` to **main bus**

**Bug fixed**:
Cooldown tracking must be keyed by **logical id**:
```
const logicalId = sensor.publishAs ?? sensor.id
```

All internal maps must use `logicalId`.

---

## What is *not* implemented yet (by design)

- Long/short press classification
- Button sequences (S–L–S)
- USB/serial button driver
- i2c devices

These are intentionally deferred.

---

## What you want to implement next

### Primary goal
Implement and finalize the **real GPIO push button driver path** in a clean, data-driven way.

Specifically:
- real GPIO button via libgpiod signal
- activation via `enabled + modes`
- correct `publishAs` behavior
- no architecture deepening
- no global hw/virt branching

---

## Concrete next steps (high confidence)

1) **Normalize button config**
  - Stop using misleading `type: 'gpioButton'`
  - Use:
    - `role: 'button'`
    - backend via `sensor.hw.*`

2) **Tighten driver instantiation logic**
  - In the existing driver factory:
    - filter sensors by `enabled && modes.includes(currentMode)`
    - choose backend via `hw.gpio | hw.virtual`
  - Do **not** add new layers or managers

3) **Finalize GPIO button driver**
  - Confirm:
    - rising edge semantics
    - `activeHigh` handling
    - clean `dispose()`
  - Publish **only transitions**

4) **Keep virtual hardware intact**
  - `virt press` must continue to:
    - drive a virtual signal
    - produce `buttonRaw:edge`
    - flow through the same controller

---

## Files to paste into the next chat

Paste these files (or relevant excerpts) to continue seamlessly:

### Runtime / activation
- `src/app/args.js`
- `src/app/appRunner.js`

### Driver factory & signals
- `src/app/hwDrivers.js`
- `src/hw/signal/gpioBinarySignalGpiod.js`
- `src/hw/signal/virtualBinarySignal.js`

### Button path
- `src/hw/button/gpioButtonDriver.js`
- `src/domain/button/edgeButtonController.js`
- `src/domain/domainEventTypes.js`
- `src/core/eventTypes.js`

### CLI virtual hardware (if touched)
- `src/cli/cliController.js`
- `src/cli/cliParser.js`

### Config example
- A small excerpt from `config/defaultConfig.json5` showing:
  - one GPIO button
  - one virtual button
  - `modes`
  - `publishAs`

---

## First message for the next chat

Copy-paste this as the **first line** of the new conversation:

> “Continue Project CHARLIE: implement GPIO push button driver (real hardware) using activation profiles (`--mode`) and per-device `hw` backends. Architecture must remain shallow. Here are the current relevant files: …”

---

## Suggested conversation title

**“Project CHARLIE — Virtual Hardware Normalization & GPIO Button Driver”**

---
