# Raspberry Pi 4 – Clean Network Stack Setup
## systemd-networkd + wpa_supplicant + WireGuard-ready

This guide migrates a Raspberry Pi 4 (Debian) from legacy `ifupdown + dhclient` to a **clean, deterministic, extensible network stack** suitable for:

- Ethernet (`eth0`)
- Wi-Fi (`wlan0`)
- USB tethering (`usb0`)
- WireGuard (`wg0`)
- Reverse proxy (nginx / HAProxy)
- Dynamic DNS
- Multi-uplink failover

---

## 0. Design goals

- Explicit ownership of every interface
- Deterministic boot & reconnect behavior
- Hotplug-safe (USB tethering)
- WireGuard-friendly
- Minimal glue scripts
- Fully observable via systemd

---

## 1. Prerequisites

Ensure required packages are installed:

```bash
sudo apt update
sudo apt full-upgrade
sudo apt install -y systemd-networkd wpa_supplicant wireguard
```

---

## 2. Disable legacy networking (clean cut)

### 2.1 Disable ifupdown DHCP activity

Stop running dhclient instances:
```bash
sudo pkill dhclient
```

Prevent ifupdown from auto-starting DHCP:
```bash
sudo systemctl disable networking --now
```

(We are **not uninstalling** ifupdown; just disabling it.)

---

### 2.2 Disable NetworkManager (if present)

```bash
sudo systemctl disable NetworkManager --now 2>/dev/null || true
```

---

## 3. Enable systemd-networkd

```bash
sudo systemctl enable systemd-networkd --now
```

Verify:
```bash
systemctl is-active systemd-networkd
```

Expected:
```
active
```

---

## 4. Ethernet configuration (eth0)

Create:
```bash
sudo nano /etc/systemd/network/10-eth0.network
```

```ini
[Match]
Name=eth0

[Network]
DHCP=yes
```

---

## 5. Wi-Fi configuration (wlan0)

### 5.1 systemd-networkd (IP layer)

Create:
```bash
sudo nano /etc/systemd/network/20-wlan0.network
```

```ini
[Match]
Name=wlan0

[Network]
DHCP=yes
```

---

### 5.2 wpa_supplicant (auth + reconnect)

Create:
```bash
sudo nano /etc/wpa_supplicant/wpa_supplicant-wlan0.conf
```

```ini
ctrl_interface=DIR=/run/wpa_supplicant GROUP=netdev
update_config=1
country=NL

network={
    ssid="YOUR_SSID"
    psk="YOUR_PASSWORD"
}
```

Secure it:
```bash
sudo chmod 600 /etc/wpa_supplicant/wpa_supplicant-wlan0.conf
```

Enable interface-bound service:
```bash
sudo systemctl enable wpa_supplicant@wlan0 --now
```

---

## 6. USB tethering (usb0)

This works automatically when a phone is plugged in.

Create:
```bash
sudo nano /etc/systemd/network/30-usb0.network
```

```ini
[Match]
Name=usb0

[Network]
DHCP=yes
```

No service restart needed — hotplug is automatic.

---

## 7. Restart networking cleanly

```bash
sudo systemctl restart systemd-networkd
sudo ip link set eth0 up
sudo ip link set wlan0 up
```

---

## 8. Verification checklist

```bash
networkctl list
networkctl status eth0
networkctl status wlan0
```

```bash
ip addr
ip route
```

```bash
iw dev wlan0 link
```

Expected:
- eth0: DHCP address
- wlan0: associated + DHCP
- usb0: appears when tethering is active

---

## 9. WireGuard readiness (no config yet)

systemd-networkd supports WireGuard natively.

Later you will add:
```
/etc/systemd/network/40-wg0.netdev
/etc/systemd/network/40-wg0.network
```

No extra tooling required.

---

## 10. Why this setup scales

- Multiple uplinks: route metrics supported
- Failover: deterministic, script-free
- Reverse proxy: stable interface binding
- DynDNS: hook into `network-online.target`
- USB tethering: zero config on hotplug
- Monitoring: `networkctl`, `journalctl`

---

## 11. Useful commands

Watch Wi-Fi reconnects:
```bash
journalctl -u wpa_supplicant@wlan0 -f
```

Watch network events:
```bash
journalctl -u systemd-networkd -f
```

---

## 12. Next logical steps (optional)

- Set route priorities (eth0 > wlan0 > usb0)
- Add WireGuard with fail-closed routing
- Integrate link-state notifications
- Attach DynDNS updates to uplink changes

---

## Summary

This configuration gives you a **clean, modern, production-grade network foundation** on an RPi4 — aligned with WireGuard, reverse proxies, dynamic uplinks, and future automation.

You now have:
- one IP manager
- one Wi-Fi authority
- zero ambiguity

Ready for the next layer.
