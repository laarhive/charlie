# Deployment checklist (Raspberry Pi)

Use this checklist when deploying Charlie to a Raspberry Pi for **real hardware operation**.

---

## System prerequisites
- [ ] Raspberry Pi OS / Debian installed and up to date
- [ ] Network connectivity confirmed (LAN / Wi-Fi)
- [ ] SSH access working
- [ ] Correct system time (`timedatectl status`)

---

## Charlie installation
- [ ] Repository cloned to a fixed location (recommended: `/opt/charlie`)
- [ ] Correct ownership set (`charlie:charlie` or service user)
- [ ] Node.js installed (project-supported version)
- [ ] Yarn Berry available via Corepack
- [ ] Dependencies installed (`yarn install --immutable`)
- [ ] `config/defaultConfig.json5` created and validated

---

## GPIO backend (libgpiod)

Project CHARLIE uses **libgpiod v2 CLI tools** instead of pigpio.

- [ ] `gpiod` package installed
- [ ] `gpiomon`, `gpioset`, `gpioinfo` available in `$PATH`
- [ ] `gpio` group exists
- [ ] Service user added to `gpio` group
- [ ] `/dev/gpiochip*` permissions set via udev (`root:gpio`, mode `0660`)
- [ ] Re-login or reboot performed after group change
- [ ] `gpioinfo -c gpiochip0 <line>` works without sudo
- [ ] Loopback test passes (`gpiomon` + `gpioset`)
- [ ] GPIO line numbers match wiring (BCM numbering)
- [ ] Watchdog loopback pins reserved (not used by sensors)

📄 See:  
`docs/rpi/gpio-libgpiod-setup.md`

---

## Sensors & wiring
- [ ] LD2410 / presence sensors powered and connected
- [ ] SW-420 vibration sensors connected and adjusted
- [ ] Button / reed switch wired correctly
- [ ] Sensor IDs, roles, zones correctly defined in config
- [ ] `enabled: true` set for intended sensors

---

## Charlie systemd service
- [ ] `charlie.service` file created
- [ ] `After=network.target` set
- [ ] `WorkingDirectory` correct
- [ ] `ExecStart` uses:
  - `--cmd daemon`
  - `--mode hw`
  - correct config path
- [ ] Service user has access to repo directory
- [ ] `systemctl daemon-reload` run
- [ ] `charlie` service enabled
- [ ] `charlie` service started successfully

📄 See:  
`docs/setup/raspberry-pi-systemd.md`

---

## Runtime verification
- [ ] `systemctl status charlie` shows **active (running)**
- [ ] No crash loops in `journalctl -u charlie`
- [ ] GPIO watchdog reports `status: ok`
- [ ] No recurring GPIO `busy` or permission errors
- [ ] WebSocket server listening on expected port
- [ ] REST API reachable (`/api/status`)

---

## CLI attachment (post-deploy check)

From the Pi or over SSH:

```shell
node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787
```

- [ ] CLI connects successfully
- [ ] `core state` returns a valid snapshot
- [ ] `hardware.status.gpio` is `ok`
- [ ] `driver list` shows expected drivers
- [ ] `started: true` for active drivers
- [ ] `tap main on` shows live events
- [ ] `inject status` reports correct state

---

## Sensor smoke tests (recommended)

Using real-world interaction:

- [ ] Presence detected when approaching
- [ ] Presence exit detected when leaving
- [ ] Vibration hit detected on physical tap
- [ ] Button press detected
- [ ] No excessive bouncing or false positives

Use CLI taps for visibility:
- `tap presence on`
- `tap vibration on`
- `tap main on`

---

## Tasker integration (if enabled)
- [ ] Tasker base URL configured
- [ ] `/tasker/start` and `/tasker/stop` reachable
- [ ] Conversation start/stop events flow correctly
- [ ] No blocking when Tasker is offline

---

## Production hardening (recommended)
- [ ] WebSocket server bound to `127.0.0.1` only
- [ ] Remote CLI access via SSH tunnel
- [ ] No unnecessary ports exposed
- [ ] Logs monitored periodically
- [ ] Automatic restarts confirmed (crash recovery)
- [ ] GPIO auto-reclaim behavior verified (if enabled)

---

## Deployment complete

Charlie is now running as a **headless, autonomous, recoverable service** and can be safely left unattended.

If something goes wrong:
1. Check `journalctl -u charlie`
2. Attach CLI and inspect state
3. Check GPIO status and consumers (`gpioinfo`)
4. Restart service
