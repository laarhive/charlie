<!-- docs/interfaces/index.md -->
# Interface index

This section points to the in-code contracts. Interface details live in JSDoc to reduce drift.

## Events

Charlie uses structured events across buses. Each event has:
- type
- ts (timestamp)
- source
- payload

Event type strings are centralized in code.

Where to look:
- Domain event types: src/domain/domainEventTypes.js
- Main (semantic) event types: src/core/eventTypes.js

## Devices

Device configuration fields and allowed values are defined in code.

Key concepts:
- device.id
- device.publishAs (logical identity)
- device.kind (driver implementation)
- device.protocol (gpio/uart/i2c/virt + parameters)
- device.domain (routes to a controller)
- device.role (used by core behavior)
- device.modes (activation profiles)
- device.state (active/manualBlocked)

## Device Manager and state

State model:
- configured: active | manualBlocked
- runtime: active | degraded | manualBlocked

Health/state events are published on the main bus so other components (CLI, alarms, logs) can react.

## Command injection

Command injection targets devices/drivers.

Each driver kind defines its supported commands and payload schema.
These are documented next to the driver implementation via JSDoc.

## Documentation rule

- Markdown explains architecture and responsibilities.
- JSDoc defines exact field names, enums, payload shapes, and examples.
```
