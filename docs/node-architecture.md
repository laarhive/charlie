# Node.js App Architecture

## Design goals
- Event-driven system
- Clean separation between:
  - hardware drivers
  - domain interpretation
  - core behavior
  - conversation adapter
- Consistent testing story (Win11 + RPi)
- Simulation mode for fast iteration
- Debugging via bus taps

## Buses
Charlie uses multiple EventBus instances.

### Main bus (`buses.main`)
- Carries semantic events consumed by CharlieCore:
  - presence enter/exit by zone
  - vibration hit level
  - button press short/long
  - time events (scheduled)
  - conversation telemetry (later)

### Domain buses
- Carry raw-ish signals produced by drivers
- Consumed only by the domain controllers
- Can be tapped independently
- Current buses:
  - `buses.presence`
  - `buses.vibration`
  - `buses.button`

## Domain layer (controllers)
Domain controllers normalize raw signals into semantic events on the main bus.

### PresenceController (binary / targets)
- Binary presence (LD2410): debounces and publishes presence enter/exit
- Targets presence (LD2450): will map x/y to zones and publish enter/exit

### VibrationController (hit / samples)
- Hit vibration (SW-420): cooldown + level mapping
- Sample vibration (accelerometer): computes magnitude thresholds (future)

### PushButtonController
- Edge-based press → short/long classification (future)

## Hardware layer (drivers)
Drivers talk to devices and publish raw events to domain buses.

Examples:
- `Ld2410Driver` publishes `presenceRaw:binary`
- `Sw420Driver` publishes `vibrationRaw:hit`
- `GpioButtonDriver` publishes `buttonRaw:edge`

Drivers do NOT:
- debounce
- cooldown
- decide “front/back logic”
  Those are domain-controller concerns.

## Core layer
### CharlieCore
- Consumes semantic events from `buses.main`
- State machine:
  - IDLE → ARMING → ACTIVE → COOLDOWN
- Uses TimeScheduler to schedule time events instead of tick/polling
- Selects prompts/modes using RuleEngine
- Calls ConversationAdapter to start/stop voice on the phone

### TimeScheduler
- Schedules time events using setTimeouts
- Integrates with Clock:
  - In frozen clock mode (tests), it does not arm long real timeouts
  - Fires due events when clock advances

## Simulation mode
In sim mode:
- CLI injects semantic events directly onto main bus:
  - presence front/back on/off
  - vibration low/high
  - button short/long
- This is intended to test Charlie behavior quickly without sensor logic in the loop.

## Bus taps
`BusTap` can subscribe to any bus and log events.
Taps are created per bus:
- main, presence, vibration, button
  You can toggle them at runtime via CLI commands.

## Modules/classes (current)
- `src/app/*`: runner, config loader, args, context builder
- `src/core/*`: EventBus, BusTap, CharlieCore, TimeScheduler
- `src/domain/*`: domainEventTypes + controllers
- `src/hw/*`: drivers and signal primitives
- `src/sim/*`: CLI sim controller
