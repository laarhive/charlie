## Deployment checklist (Raspberry Pi)

Use this checklist when deploying Charlie to a Raspberry Pi for real hardware operation.

---

### System prerequisites
- [ ] Raspberry Pi OS / Debian installed and up to date
- [ ] Network connectivity confirmed (LAN / Wi-Fi)
- [ ] SSH access working
- [ ] Correct system time (`timedatectl status`)

---

### Charlie installation
- [ ] Repository cloned to a fixed location (recommended: `/opt/charlie`)
- [ ] Correct ownership set (`pi:pi` or service user)
- [ ] Node.js installed (compatible version)
- [ ] Dependencies installed (`npm install`)
- [ ] `config/defaultConfig.json5` created and validated

---

### GPIO backend (pigpio)
- [ ] `pigpio` package installed
- [ ] `pigpiod.service` created
- [ ] `pigpiod` enabled and started
- [ ] `pigs t` returns a number (daemon responding)
- [ ] `gpio.backend` set to `"pigpio"` in config
- [ ] GPIO lines match wiring (BCM numbering)
- [ ] Optional `glitchFilterUs` configured for buttons / reed switches

📄 See:  
`docs/setup/raspberry-pi-gpio.md`

---

### Sensors & wiring
- [ ] LD2410 / presence sensors powered and connected
- [ ] SW-420 vibration sensors connected and adjusted
- [ ] Button / reed switch wired correctly
- [ ] Sensor IDs, roles, zones correctly defined in config
- [ ] `enabled: true` set for intended sensors

---

### Charlie systemd service
- [ ] `charlie.service` file created
- [ ] `After=network.target pigpiod.service` set
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

### Runtime verification
- [ ] `systemctl status charlie` shows **active (running)**
- [ ] No crash loops in `journalctl -u charlie`
- [ ] WebSocket server listening on expected port
- [ ] REST API reachable (`/api/status`)

---

### CLI attachment (post-deploy check)
From the Pi or over SSH:

```shell
node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787
```

- [ ] CLI connects successfully
- [ ] `core state` returns a valid snapshot
- [ ] `driver list` shows expected drivers
- [ ] `started: true` for active drivers
- [ ] `tap main on` shows live events
- [ ] `inject status` reports correct state

---

### Sensor smoke tests (recommended)
Using real-world interaction:

- [ ] Presence detected when approaching
- [ ] Presence exit detected when leaving
- [ ] Vibration hit detected on physical tap
- [ ] Button press detected
- [ ] No excessive bouncing / false positives

Use CLI taps for visibility:
- `tap presence on`
- `tap vibration on`
- `tap main on`

---

### Tasker integration (if enabled)
- [ ] Tasker base URL configured
- [ ] `/tasker/start` and `/tasker/stop` reachable
- [ ] Conversation start/stop events flow correctly
- [ ] No blocking when Tasker is offline

---

### Production hardening (recommended)
- [ ] WebSocket server bound to `127.0.0.1` only
- [ ] Remote CLI access via SSH tunnel
- [ ] No unnecessary ports exposed
- [ ] Logs monitored periodically
- [ ] Automatic restarts confirmed (crash recovery)

---

### Deployment complete
Charlie is now running as a **headless, autonomous, recoverable service** and can be safely left unattended.

If something goes wrong:
1. Check `journalctl -u charlie`
2. Attach CLI and inspect state
3. Verify pigpiod and wiring
4. Restart service
