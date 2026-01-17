# GPIO Setup (libgpiod v2) — Raspberry Pi 4 on Debian 14 (Trixie)

This project uses **libgpiod v2 CLI tools** instead of pigpio.

Tools used:
- `gpiomon` (monitor GPIO edges)
- `gpioset` (drive / hog GPIO outputs)
- `gpioinfo` (inspect GPIO line ownership and consumers)

---

## Install GPIO dependencies

```shell
sudo apt update
sudo apt install -y gpiod
```

Verify binaries are available:

```shell
command -v gpiomon
command -v gpioset
command -v gpioinfo

gpiomon --version
gpioset --version
gpioinfo --version
```

---

## Allow non-root access to GPIO

Access to `/dev/gpiochip*` should be granted via a dedicated `gpio` group.

### Create group and add user

```shell
sudo groupadd -f gpio
sudo usermod -aG gpio charlie
```

### Udev rule for gpiochip devices

Create the rule:

```shell
sudo tee /etc/udev/rules.d/60-gpiochip.rules >/dev/null <<'EOF'
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
EOF
```

Reload rules and trigger:

```shell
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Re-login or reboot so group membership applies.

Verify:

```shell
id
ls -la /dev/gpiochip*
```

Expected:
- `/dev/gpiochip*` owned by `root:gpio`
- mode `0660`
- user `charlie` is in group `gpio`

---

## Sanity checks

### Inspect a GPIO line

```shell
gpioinfo -c gpiochip0 17
```

This shows:
- line direction
- whether it is in use
- consumer string (if any)

---

## Loopback test (recommended)

Use two free GPIOs (example: GPIO17 and GPIO27).

Hardware:
- GPIO17 → output
- GPIO27 → input
- Jumper wire between GPIO17 and GPIO27
- Optional but recommended: 10k pull-down resistor from GPIO27 to GND

### Terminal A — monitor input

```shell
gpiomon -c gpiochip0 --num-events=10 --bias pull-down 27
```

### Terminal B — drive output

```shell
gpioset -c gpiochip0 17=1
```

While `gpioset` is running, you should see an edge in Terminal A.

Stop `gpioset` with Ctrl+C — another edge should appear.

Inspect ownership:

```shell
gpioinfo -c gpiochip0 17
gpioinfo -c gpiochip0 27
```

---

## Troubleshooting

List active GPIO CLI processes:

```shell
ps aux | grep -E 'gpiomon|gpioset' | grep -v grep
```

Notes:
- `gpioset` holds a line only while the process is running
- Lines are automatically released when the process exits
- This project manages lifecycle and cleanup internally
