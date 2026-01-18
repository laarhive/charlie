# docs/architecture/devices.md

# Devices

This document defines the device layer in Charlie Core.

## Terms

- **Device**: a configured runtime component that interacts with the outside world (hardware or virtual) and publishes events.
- **Protocol**: an IO implementation used by a device (gpio, uart, virt, etc.).
- **Domain bus**: carries raw-ish events produced by devices and consumed by domain controllers.
- **Domain controller**: normalizes raw domain events into semantic main-bus events.
- **Main bus**: carries semantic events consumed by CharlieCore.

## Responsibilities

### Device
A device:
- is instantiated from a config entry (`config.devices[]`)
- creates and owns its protocols
- publishes raw domain events (or system events) to a bus
- supports block/unblock
- supports injection with a generic payload (string/JSON) interpreted by the device kind

A device does NOT:
- apply debounce/cooldown/semantic mapping (that belongs to controllers)
- contain core decision logic (that belongs to CharlieCore)

### Protocol
A protocol:
- provides IO primitives (subscribe/read/write/etc.)
- can throw on construction if the platform/tools are missing
- does not publish to buses

## Lifecycle

Configured state (from config):
- `active`
- `manualBlocked`

Runtime state (reported by DeviceManager via `system:hardware`):
- `active`
- `degraded`
- `manualBlocked`

Rules:
- `manualBlocked` means the device should not run.
- `degraded` means the device is configured active but not functioning.
- recovery is device-specific (DeviceManager calls `unblock()`, device decides what to do).

## Device Manager contract

DeviceManager:
- chooses which devices to create based on mode + configured state
- creates device instances via the kind registry
- calls `start()` once during activation
- calls `block()` / `unblock()` on request
- forwards `inject(deviceId, payload)` to the device
- publishes runtime state changes as `system:hardware` events on main bus

DeviceManager does NOT:
- build protocols
- interpret injection payloads
- implement device-specific recovery logic

## Injection

There are two separate injection surfaces:

1) **Semantic injection** (core testing)
- publishes semantic events directly on the main bus
- uses `coreRole` in payloads (not deviceId)

2) **Device injection** (device testing / virtual control)
- routes to `device.inject(payload)`
- payload is a raw string or JSON; device kind decides what it means

## Required fields

Each config.devices entry should include:
- `id`
- `kind`
- `domain` (which bus the device publishes to, or `main` for system devices)
- `modes` (activation profiles)
- `state` (`active` or `manualBlocked`)
- `protocol` (protocol config object used by the device kind)

Optional:
- `publishAs`
- `coreRole` (used by controllers when publishing semantic events)
- `params` (device-specific parameters)

## Error handling

- If `start()` throws: DeviceManager publishes `degraded`.
- If a device encounters runtime faults: the device should publish `system:hardware` (details) and may enter a degraded internal state.
- Recovery:
  - manual: `device unblock <id>` calls `device.unblock()`
  - device decides whether it can re-init protocols, restart timers, etc.
