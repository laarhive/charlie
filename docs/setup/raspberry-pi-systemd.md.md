# Charlie systemd Service (appRunner)

This document explains how to run **Charlie (appRunner)** as a persistent `systemd` service on a Raspberry Pi (Debian), suitable for headless and production use.

The service runs Charlie in **daemon mode**, exposing the WebSocket and REST APIs for CLI and future Web UI access.

---

## Why systemd

- Automatic start on boot
- Automatic restart on crashes
- Clean separation between:
  - long-running daemon
  - remote CLI / Web UI
- Required for unattended outdoor deployment

---

## 1) Choose install location

It is recommended to keep the Charlie repository in a fixed location, e.g.:

```bash
/opt/charlie
```

Example:

```bash
sudo mkdir -p /opt/charlie
sudo chown -R pi:pi /opt/charlie
cd /opt/charlie
git clone <your-repo-url> .
```

Ensure dependencies are installed:

```bash
npm install
```

---

## 2) Create the systemd service unit

Create the unit file:

```bash
sudo nano /etc/systemd/system/charlie.service
```

Paste:

```ini
[Unit]
Description=Charlie Interactive Mascot
After=network.target pigpiod.service
Wants=network.target pigpiod.service

[Service]
Type=simple

# Adjust user/group if needed
User=pi
Group=pi

WorkingDirectory=/opt/charlie

ExecStart=/usr/bin/node src/app/appRunner.js \
  --cmd daemon \
  --mode hw \
  --config config/defaultConfig.json5 \
  --log-level info

Restart=on-failure
RestartSec=3

# Environment
Environment=NODE_ENV=production

# Hardening (safe defaults)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/charlie

[Install]
WantedBy=multi-user.target
```

Notes:
- `pigpiod.service` is listed as a dependency if using GPIO
- Charlie runs **without an attached CLI**
- All interaction is done via WebSocket / REST

---

## 3) Enable and start the service

Reload systemd:

```bash
sudo systemctl daemon-reload
```

Enable on boot:

```bash
sudo systemctl enable charlie
```

Start now:

```bash
sudo systemctl start charlie
```

Check status:

```bash
sudo systemctl status charlie --no-pager
```

---

## 4) Logs and debugging

View recent logs:

```bash
journalctl -u charlie -n 200 --no-pager
```

Follow logs live:

```bash
journalctl -u charlie -f
```

If Charlie crashes, systemd will automatically restart it.

---

## 5) Attach the CLI (recommended workflow)

From the same Pi (new terminal or SSH session):

```bash
node src/app/appRunner.js --cmd cli --host 127.0.0.1 --port 8787
```

From another machine (debug mode, LAN exposed):

```bash
node src/app/appRunner.js --cmd cli --host <pi-ip> --port 8787
```

Multiple CLI clients can connect simultaneously.

---

## 6) Production hardening (recommended)

### Bind WebSocket to localhost only
In production, restrict access and use SSH tunneling:

```bash
ssh -L 8787:127.0.0.1:8787 pi@<pi-ip>
```

Then connect CLI to:

```bash
--host 127.0.0.1
```

### Optional: reverse proxy
If exposing a Web UI later, place Nginx/Caddy in front of Charlie and add authentication.

---

## 7) Stopping and restarting

Stop Charlie:

```bash
sudo systemctl stop charlie
```

Restart after config or code changes:

```bash
sudo systemctl restart charlie
```

Disable on boot:

```bash
sudo systemctl disable charlie
```

---

## 8) Common issues

### Service fails immediately
Check logs:

```bash
journalctl -u charlie -n 200 --no-pager
```

Common causes:
- wrong `WorkingDirectory`
- missing `npm install`
- invalid config file path

### GPIO not working
Ensure:
- `pigpiod` is running
- `charlie.service` depends on `pigpiod.service`
- GPIO backend is set to `pigpio` in config

### Port already in use
If port `8787` is already bound:
- change `server.port` in config
- update CLI `--port` accordingly

---

This setup is intended to be:
- **boring**
- **predictable**
- **recoverable**

Exactly what you want for an outdoor, autonomous device.
