# charlie

## High-level module map

```
src/
 ├─ app/
 │   ├─ CharlieApp
 │   └─ Bootstrap
 │
 ├─ core/
 │   ├─ CharlieCore
 │   ├─ StateMachine
 │   └─ ZoneArbiter
 │
 ├─ sensors/
 │   ├─ SensorsController
 │   ├─ PresenceSensor
 │   ├─ VibrationSensor
 │   └─ ButtonSensor
 │
 ├─ gpio/
 │   ├─ GpioInterface
 │   ├─ HwGpio
 │   └─ SimGpio
 │
 ├─ actuators/
 │   └─ LedController
 │
 ├─ config/
 │   ├─ ConfigStore
 │   ├─ RuleEngine
 │   └─ PromptRepository
 │
 ├─ conversation/
 │   ├─ ConversationAdapter
 │   ├─ TaskerClient
 │   └─ LocalTestAdapter
 │
 ├─ web/
 │   ├─ WebServer
 │   ├─ WsRouter
 │   └─ AdminApi
 │
 ├─ logging/
 │   ├─ EventStore
 │   └─ RuntimeStateStore
 │
 ├─ sim/
 │   └─ SimulationController
 │
 └─ test/
     ├─ fakes/
     ├─ scenarios/
     └─ helpers/

```
## Bus Layout

1) Domain buses (HW/internal)

These carry raw-ish signals and are only consumed by their domain controller:
* `presenceBus`
* `vibrationBus`
* `buttonBus`

**Producers**: HW drivers + sim drivers<br>
**Consumers**: `presenceController`, `vibrationController`, `pushButtonController`

2) App bus (main)

This carries normalized events only:
* `presence:enter/exit (zone)`
* `vibration:hit (level)`
* `button:press`
* time events, core, conversation telemetry, etc.

**Producer**: domain controllers<br>
**Consumers**: `CharlieCore`, rule engine, logging, etc.

This keeps CharlieCore stable forever, even as we swap sensors/drivers.

## Event Namespace

On domain buses:

1) Presence bus
* `presenceRaw:binary` payload `{ sensorId, zone?, present }` (LD2410)
* `presenceRaw:targets` payload `{ sensorId, targets: [...] }` (LD2450)
* `presenceRaw:status` (optional)

2) Vibration bus

* `vibrationRaw:hit` payload `{ sensorId }` (SW-420)
* `vibrationRaw:sample` payload `{ sensorId, ax, ay, az }` (accelerometer)

3) Button bus
* `buttonRaw:level` payload `{ sensorId, down }`
or
* `buttonRaw:pressEdge`

Then controllers translate → app bus events.

## Tapping / debugging (your key requirement)

`tap main` for app bus.
`tap presence`, `tap vibration`, `tap button` for domain buses.

Taps can be enabled independently:

* debug only vibration by enabling `tap vibration`
* keep others off in production
* works identically in sim + hw
