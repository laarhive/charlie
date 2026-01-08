# System Overview

## Core idea
Charlie is a mascot that behaves like a character, not a robot. The system separates:
- sensing (hardware signals)
- interpretation (turn signals into “presence/vibration/button” semantics)
- decision logic (when to talk and what to say)
- voice interface (phone)

## Components
### Raspberry Pi (Node.js)
- Runs the “brain”
- Handles sensors
- Implements state machine:
  - IDLE → ARMING → ACTIVE → COOLDOWN
- Schedules time-based transitions via TimeScheduler
- Publishes and subscribes to internal events via EventBus

### Phone (Android)
- Runs ChatGPT Voice and plays audio out via speaker
- Tasker automates launching ChatGPT and injecting prompts
- Optional: Tasker posts callbacks to the Pi for conversation telemetry (start/end, turn count, idle detection)

## Data flow (conceptual)
Sensors → domain raw buses → domain controllers → main bus → core → phone triggers

## Why this split
- Can swap presence sensors (LD2410 → LD2450) without touching CharlieCore
- Can test behavior without hardware using sim mode
- Can debug only one subsystem by tapping the relevant bus
