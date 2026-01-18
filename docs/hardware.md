<!-- docs/hardware.md -->
# Hardware

This document lists the physical components used by Charlie.

## Charlie Core host

### Raspberry Pi
- Role: devices + controllers + core orchestration
- OS: Debian (headless)
- Runtime: Node.js
- GPIO: libgpiod tools via the project GPIO module

## Charlie AI host

### Android phone
- Role: voice interface (ChatGPT Voice)
- Tasker: automation + callbacks (optional)

## Sensors and outputs

### Presence
- LD2410 (binary presence)
- LD2450 (targets / xy) planned

Zones:
- front
- back

### Vibration
- SW-420 (hit detection)
- Accelerometer planned for richer signals

### Button
- Push button
- Reed switch planned

### LEDs / outputs
- Simple RGB modules
- WS2812 (planned)

## GPIO notes

- GPIO access is via libgpiod tools.
- Use the watchdog loopback device to validate GPIO health.
- Avoid using watchdog pins for other sensors.

See:
- `docs/rpi/gpio-libgpiod-setup.md`
