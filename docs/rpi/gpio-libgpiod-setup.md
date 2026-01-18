<!-- docs/rpi/gpio-libgpiod-setup.md -->
# GPIO setup (libgpiod v2)

Charlie uses libgpiod v2 CLI tools via the project GPIO module.

Tools:
- `gpiomon`
- `gpioset`
- `gpioinfo`

## Install dependencies
```bash
sudo apt update
sudo apt install -y gpiod
```

Verify:
```bash
command -v gpiomon
command -v gpioset
command -v gpioinfo
```

## Allow non-root access
```bash
sudo groupadd -f gpio
sudo usermod -aG gpio charlie
```

Udev rule:
```bash
sudo tee /etc/udev/rules.d/60-gpiochip.rules >/dev/null <<'EOF'
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
EOF
```

Reload:
```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Verify:
```bash
id
ls -la /dev/gpiochip*
```

## Loopback test
Example pins: GPIO17 (out) and GPIO27 (in).

Terminal A:
```bash
gpiomon -c gpiochip0 --num-events=10 --bias pull-down 27
```

Terminal B:
```bash
gpioset -c gpiochip0 17=1
```

Stop gpioset (Ctrl+C) and confirm edges in Terminal A.

Inspect consumers:
```bash
gpioinfo -c gpiochip0 17
gpioinfo -c gpiochip0 27
```

## Troubleshooting
List active processes:
```bash
ps aux | grep -E 'gpiomon|gpioset' | grep -v grep
```
