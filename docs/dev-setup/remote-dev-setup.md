# Remote Development Setup (RPi4 + WebStorm)

This document describes how to set up a Raspberry Pi 4 as a **deployment and debugging target** for Project CHARLIE, while keeping development and editing local (WebStorm on PC).

The Pi is treated as a **runtime target**, not a development workstation.

---

## Target assumptions

- Raspberry Pi 4 (2GB or 4GB RAM)
- Debian (Trixie or similar)
- Repository uses:
  - Yarn Berry (v4)
  - Plug’n’Play (PnP)
  - Zero-installs
  - Git LFS
- Node.js v24.12.0 (LTS), installed manually
- The Pi will eventually be a street-deployed device

---

## GPIO setup (libgpiod)

Project CHARLIE uses **libgpiod v2 CLI tools** (`gpiomon`, `gpioset`, `gpioinfo`) for GPIO access.

Follow the dedicated GPIO setup guide on the Pi:

- `docs/rpi/gpio-libgpiod-setup.md`

This covers:
- installing `gpiod`
- non-root GPIO access via udev
- loopback tests for `gpiomon`, `gpioset`, and `gpioinfo`

---

## Install Node.js v24.12.0 (LTS, arm64)

This project standardizes on **Node.js v24.12.0 (LTS)**, installed **manually from official Node.js binaries**.

This avoids distro lag, avoids NodeSource repositories, and guarantees reproducibility across devices.

### Download and verify Node.js

```shell
cd /tmp

curl -fLO https://nodejs.org/dist/v24.12.0/node-v24.12.0-linux-arm64.tar.xz
curl -fLO https://nodejs.org/dist/v24.12.0/SHASUMS256.txt

grep 'node-v24.12.0-linux-arm64.tar.xz' SHASUMS256.txt | sha256sum -c -
```

Expected output:

```text
node-v24.12.0-linux-arm64.tar.xz: OK
```

If verification fails, **do not continue**.

---

## Install Node.js into `/opt`

```shell
sudo rm -rf /opt/node-v24.12.0
sudo mkdir -p /opt/node-v24.12.0

sudo tar -xJf /tmp/node-v24.12.0-linux-arm64.tar.xz \
  -C /opt/node-v24.12.0 \
  --strip-components=1
```

Expose binaries system-wide:

```shell
sudo ln -sf /opt/node-v24.12.0/bin/node /usr/local/bin/node
sudo ln -sf /opt/node-v24.12.0/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/node-v24.12.0/bin/npx /usr/local/bin/npx
sudo ln -sf /opt/node-v24.12.0/bin/corepack /usr/local/bin/corepack
```

Verify:

```shell
node -v
npm -v
corepack --version
```

Expected:

```text
v24.12.0
```

---

## Enable Corepack (required for Yarn Berry)

```shell
sudo corepack enable
```

Prepare Yarn for the project user:

```shell
corepack prepare yarn@4.12.0 --activate
```

---

## Setup repository on the Pi

### Install Git LFS

```shell
sudo apt install -y git-lfs
git lfs install
```

### Clone repository

```shell
sudo rm -rf /opt/charlie/charlie
sudo mkdir -p /opt/charlie
sudo chown -R charlie:charlie /opt/charlie

cd /opt/charlie
git clone https://github.com/laarhive/charlie.git charlie
cd /opt/charlie/charlie
```

Verify required files:

```shell
ls -la .yarn .yarnrc.yml yarn.lock package.json .pnp.cjs
```

---

## Pull Git LFS objects

```shell
git lfs pull
```

Spot-check cache:

```shell
ls -lh .yarn/cache | head -n 20
```

Files should be KB–MB, not ~130 bytes.

---

## Install build prerequisites (native modules)

```shell
sudo apt install -y build-essential python3 make g++
```

---

## Yarn install (offline, deterministic)

```shell
yarn -v
yarn install --immutable --immutable-cache
```

---

## Enable development scripts

```shell
chmod +x scripts/**/*.sh
```

### Examples

```shell
scripts/dev/restart.sh --mode hw
scripts/dev/restart.sh --mode virt
scripts/dev/restart.sh --mode hw --no-inspect
scripts/dev/restart.sh --mode hw -- --some-flag value
```

---

## Result

- Clean, reproducible Pi runtime
- ARM-native builds completed
- Single restart script for hw/virt and debug/non-debug
- Ready for WebStorm autosync and debugger attach
