<!-- docs/rpi/deployment-checklist.md -->
# Raspberry Pi deployment checklist

Use this checklist for real hardware operation.

## System prerequisites
- OS installed and updated
- Network connectivity
- SSH access
- Correct system time

## Charlie installation
- Repo cloned to a fixed location (example: `/opt/charlie`)
- Node.js installed
- Corepack/Yarn working
- Config file present at `config/defaultConfig.json5`

## GPIO (libgpiod)
- gpiod tools installed
- permissions for `/dev/gpiochip*` are correct (group + udev)
- loopback test passes

See:
- `docs/rpi/gpio-libgpiod-setup.md`

## Runtime verification
- service starts without crash loop
- watchdog device reports active
- WebSocket server listening
- CLI can attach and list devices

## Smoke tests
- presence triggers expected events
- vibration triggers expected events
- button press triggers expected events
