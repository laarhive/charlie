# Raspberry Pi GPIO Setup (pigpio)

This document sets up `pigpiod` on Debian for Charlie’s GPIO inputs (presence, vibration, button) and optional glitch filtering.

## Why pigpio
- Reliable edge callbacks from Node.js
- Supports per-pin glitch filtering (useful for reed switches and buttons)
- Optionally supports PWM if needed (though WS2812 usually uses a different library)

---

## 1) Install pigpio

On Raspberry Pi (Debian):

```bash
sudo apt update
sudo apt install -y pigpio
```

This installs:
- `pigpiod` (daemon)
- `pigs` (CLI tool)

---

## 2) Create a systemd service

Create the unit file:

```bash
sudo nano /etc/systemd/system/pigpiod.service
```

Paste:

```ini
[Unit]
Description=Pigpio daemon
Documentation=man:pigpiod(1)
After=network.target
Wants=network.target

[Service]
Type=forking
ExecStart=/usr/bin/pigpiod -l
ExecStop=/bin/kill -TERM $MAINPID
PIDFile=/run/pigpiod.pid
Restart=on-failure
RestartSec=2

# Hardening (safe defaults)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Notes:
- `-l` disables remote socket connections, keeping pigpio local-only (recommended).

---

## 3) Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable pigpiod
sudo systemctl start pigpiod
```

Check status:

```bash
sudo systemctl status pigpiod --no-pager
```

---

## 4) Quick smoke test

Check that pigpio is responding:

```bash
pigs t
```

If it prints a number, pigpiod is running.

---

## 5) Charlie config

In `config/*.json5`, choose backend:

```js
gpio: {
  backend: 'pigpio'
}
```

Per-sensor GPIO line (BCM numbering) plus optional glitch filter:

```js
hw: {
  line: 17,
  activeHigh: true,
  glitchFilterUs: 8000
}
```

- `line` is BCM GPIO number
- `glitchFilterUs` is microseconds; values like 3000–15000 are common for debouncing reed/buttons.

---

## 6) Running Charlie on the Pi

Example:

```bash
node src/app/appRunner.js --mode hw --log-level info
```

If you want CLI for debugging:

```bash
node src/app/appRunner.js --mode hw --cli --log-level debug
```

Useful tap commands:
- `tap presence on`
- `tap main on`
- `tap tasker on`

---

## 7) Troubleshooting

### pigpiod not running
- `sudo systemctl status pigpiod --no-pager`
- `journalctl -u pigpiod -n 200 --no-pager`

### Permission issues
pigpiod typically solves permission access for GPIO. If you still see issues, ensure:
- you are on Raspberry Pi hardware
- the daemon is running
- your Node process is using pigpio backend

### Conflicts with other GPIO libraries
Only one system should “own” certain hardware timing features. If you use other low-level GPIO daemons, disable them and standardize on pigpio.

---
