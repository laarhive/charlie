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

Producers: HW drivers + sim drivers
Consumers: `presenceController`, `vibrationController`, `pushButtonController`

2) App bus (main)

This carries normalized events only:
* `presence:enter/exit (zone)`
* `vibration:hit (level)`
* `button:press`
* time events, core, conversation telemetry, etc.

Producer: domain controllers
Consumers: `CharlieCore`, rule engine, logging, etc.

This keeps CharlieCore stable forever, even as we swap sensors/drivers.

## Event Namespace

Raw (on domain buses)

1) Presence raw bus
* `presenceRaw:binary` payload `{ sensorId, zone?, present }` (LD2410)
* `presenceRaw:targets` payload `{ sensorId, targets: [...] }` (LD2450)
* `presenceRaw:status` (optional)

2) Vibration raw bus

* `vibrationRaw:hit` payload `{ sensorId }` (SW-420)
* `vibrationRaw:sample` payload `{ sensorId, ax, ay, az }` (accelerometer)

3) Button raw bus
* `buttonRaw:level` payload `{ sensorId, down }`
or
* `buttonRaw:pressEdge`

Then controllers translate → app bus events.

## Tapping / debugging (your key requirement)

Instead of one global busTap, you can have:

tapMain for app bus

tapPresence, tapVibration, tapButton for domain buses

And you can enable taps independently:

debug only vibration by enabling tapVibration

keep others off in production

works identically in sim + hw

This matches what you want: “tap into this bus only”.

Why separate buses are better than “single raw bus”

less noise per tap

fewer accidental subscriptions

domain controllers stay focused

easier to unit test (you can feed just one bus)

Where drivers attach (bus vs direct wiring)

With your multi-bus approach, the cleanest is:

drivers publish onto their domain bus

controller subscribes to that bus

controller publishes normalized events to main bus

No direct driver→controller coupling needed, and you still keep the main bus clean.
