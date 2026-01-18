<!-- docs/architecture/charlie-core.md -->
# Charlie Core architecture

Charlie Core is an event-driven Node.js runtime. It separates:
- device IO
- domain normalization
- core decision logic
- external conversation control

## Buses

Charlie uses multiple EventBus instances.

### Domain buses
Domain buses carry raw-ish events produced by device drivers. They are consumed by domain controllers only.

Typical domain buses:
- presence
- vibration
- button

### Main bus
The main bus carries semantic events consumed by the core state machine and rules engine.

### Tasker bus (adapter channel)
The adapter layer uses a dedicated channel for integration with Tasker / external clients. Internally, the adapter still publishes semantic events on the main bus when needed.

## Layer responsibilities

### 1) Protocols (hardware / virtual)
A protocol is how a device talks to the world:
- gpio
- uart
- i2c
- virt (no hardware)

Protocols are selected per device instance via configuration.

### 2) Devices and drivers

#### Device
A device is a configured instance:
- has an id and optional publishAs
- declares modes in which it is active
- has a configured state (active/manualBlocked)
- has a kind (driver implementation)
- selects a protocol (gpio/uart/i2c/virt)
- belongs to a domain (routes to a controller)
- has a role (used by core logic, independent of hardware identity)

#### Driver (device kind)
A driver kind is a class that:
- reads input from its protocol port(s)
- publishes domain events to its domain bus
- may implement output and command injection (when relevant)

Not all drivers must be bidirectional, but the model supports it.

### 3) Domain controllers
Domain controllers:
- consume domain events
- apply normalization (debounce, cooldown, mapping, classification)
- publish semantic events on the main bus

Controllers do not talk to hardware.

### 4) Core
Core consumes semantic events and decides behavior:
- state machine
- timers (via scheduler, not polling)
- rule evaluation
- conversation orchestration through the adapter

## Device activation (modes + configured state)

Charlie uses activation profiles selected via `--mode`.

A device is eligible to start iff:
- currentMode is included in device.modes
- device.state === "active"

A device is never started iff:
- device.state === "manualBlocked"

## Device state model

Configured (persisted) states:
- active
- manualBlocked

Runtime (transient) states:
- active (working)
- degraded (configured active, but not currently functional)
- manualBlocked (configured blocked)

Rules:
- manualBlocked always wins
- degraded is only possible when configured state is active

## Device Manager (control and lifecycle)

Charlie Core includes a Device Manager responsible for:
- building device instances from configuration
- starting all eligible devices at boot
- tracking runtime state (including degraded)
- forwarding command injection to devices/drivers
- initiating recovery attempts (policy kept simple at first)

Observability:
- devices publish health/state events onto the main bus
- the Device Manager subscribes to the main bus to observe device health

Control:
- the Device Manager holds references to device instances and can call block/unblock/inject

## Testing surfaces

### Event injection (buses)
- Domain buses can be published to for controller tests.
- Main bus can be published to for core tests.

### Command injection (devices)
- Command injection targets devices/drivers, not controllers.
- The command schema is driver-kind specific and carried as JSON.

## Interface documentation

Event payload shapes, device config fields, and injection command schemas are defined in code via JSDoc.
See: ../interfaces/index.md
```
