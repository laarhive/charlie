<!-- src/architecture/devices/README.md -->
# Device Architecture

This folder contains the architectural contracts and device specifications for CHARLIE.

Devices are low-level **signal adapters**. They translate real-world inputs (GPIO, virtual signals, sensors) into **raw domain events**, and provide a uniform lifecycle and injection surface for simulation/testing.


## Documents

#### Device Manager:
- [Device Manager — Specification](device-manager.spec.md)

#### Devices:
- [Device Contract](device.contract.md) — **mandatory rules** all devices must follow
- [ButtonEdgeDevice](button-edge.device.md) — reference device specification (should be used when documenting new devices)
- [GpioWatchdogLoopbackDevice](gpio-watchdog-loopback.device.md)

#### USB Inventory:
- [UsbInventory — Specification](usb-inventory.spec.md)
- [UsbRebind — Contract](usb-rebind.contract.md)
