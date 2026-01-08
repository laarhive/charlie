# Hardware

## Raspberry Pi
- Role: sensing + logic + orchestration
- OS: Debian Lite (headless)
- Runtime: Node.js
- Storage: Endurance microSD recommended for reliability

## Phone (Android)
- Role: voice interface (ChatGPT Voice)
- Tasker: automation + triggers + callbacks

## Sensors and outputs (planned)
### Presence
- Current plan: LD2410 / LD2450 depending on build stage
- Zones:
  - front: passersby near entrance
  - back: exiting/behind mascot

### Vibration
- SW-420 x2 (light/heavy) initially
- Future option: accelerometer for richer vibration magnitude

### Button
- Physical pushbutton for override/service mode

### LED
- KY-016 RGB module (output only)

## Notes on deployment
- Outdoor requires good strain relief and stable power
- UPS/battery planned for short outages
