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
