# Remote Development Setup (RPi4 + WebStorm)

This document describes how to set up a Raspberry Pi 4 as a **deployment and debugging target** for Project CHARLIE, while keeping development and editing local (WebStorm on PC).

The Pi is treated as a **runtime target**, not a development workstation.



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



## Install Node.js v24.12.0 (LTS, arm64)

This project standardizes on **Node.js v24.12.0 (LTS)**, installed **manually from the official Node.js binaries**.
This avoids distro lag, avoids NodeSource repositories, and guarantees reproducibility across devices.

The installation is performed once on the Raspberry Pi.



### Download and verify the official Node.js binary

```shell
cd /tmp

curl -fLO https://nodejs.org/dist/v24.12.0/node-v24.12.0-linux-arm64.tar.xz
curl -fLO https://nodejs.org/dist/v24.12.0/SHASUMS256.txt

grep 'node-v24.12.0-linux-arm64.tar.xz' SHASUMS256.txt | sha256sum -c -
```

You should see:

```text
node-v24.12.0-linux-arm64.tar.xz: OK
```

If the checksum does not match, **do not continue**.



### Install Node.js into `/opt` and expose binaries system-wide

```shell
sudo rm -rf /opt/node-v24.12.0
sudo mkdir -p /opt/node-v24.12.0

sudo tar -xJf /tmp/node-v24.12.0-linux-arm64.tar.xz \
  -C /opt/node-v24.12.0 \
  --strip-components=1
```

Create symlinks in `/usr/local/bin` so Node is available system-wide
without interfering with distro packages:

```shell
sudo ln -sf /opt/node-v24.12.0/bin/node /usr/local/bin/node
sudo ln -sf /opt/node-v24.12.0/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/node-v24.12.0/bin/npx /usr/local/bin/npx
sudo ln -sf /opt/node-v24.12.0/bin/corepack /usr/local/bin/corepack
```



### Verify installation

```shell
which node
node -v
npm -v
corepack --version
```

Expected output includes:

```text
v24.12.0
```

If `node` fails to run after installation, clear the shell command cache:

```shell
hash -r
```

or start a new shell session.



### Enable Corepack (required for Yarn Berry)

Yarn is managed via Corepack. Enable Corepack once system-wide:

```shell
sudo corepack enable
```


### Prepare the exact Yarn version declared by the project (once per user)

Corepack stores prepared package manager versions **per user**.  
Run this as the project user (`charlie`) to avoid interactive download prompts later:

```shell
corepack prepare yarn@4.12.0 --activate
```

This allows the project to use the exact Yarn version declared in `package.json`
(the `packageManager` field).

Note: Running the same command with `sudo` prepares Yarn for `root`, not for `charlie`.



### Result

At this point:
- Node.js v24.12.0 is installed in a deterministic, non-distro-managed way
- `node`, `npm`, `npx`, and `corepack` are available system-wide
- The system is ready for Yarn Berry (PnP / zero-installs)



## Setup repository on RPi

### Install and activate Git LFS on the Pi

```shell
sudo apt install -y git-lfs
git lfs install
```



### Fresh clone on the Pi

```shell
# Wipe any existing working copy (clean start)
sudo rm -rf /opt/charlie/charlie
sudo mkdir -p /opt/charlie
sudo chown -R charlie:charlie /opt/charlie

# Clone repository
cd /opt/charlie
git clone https://github.com/laarhive/charlie.git charlie
cd /opt/charlie/charlie

# Sanity check: required files must exist
ls -la .yarn .yarnrc.yml yarn.lock package.json .pnp.cjs
```



### Pull Git LFS objects (critical for zero-installs)

```shell
cd /opt/charlie/charlie
git lfs pull
```

Spot-check that cache files are real (not LFS pointers):

```shell
ls -lh .yarn/cache | head -n 20
```

Cache files should be **KB–MB**, not ~130 bytes.



### Install build prerequisites (for pigpio / uWebSockets)

```shell
# Do this once
sudo apt install -y build-essential python3 make g++
```



### Yarn install on Pi (deterministic, no network)

This step:
- Uses committed `.yarn/cache`
- Builds ARM-native unplugged artifacts
- Does NOT allow network access

```shell
cd /opt/charlie/charlie
yarn -v
yarn install --immutable --immutable-cache
```

If this fails, the cache or lockfile is inconsistent and must be fixed on the development machine.



## Enable development scripts on the Pi

Ensure all scripts are executable:

```shell
cd /opt/charlie/charlie
chmod +x scripts/**/*.sh
```

### Examples (run on the Pi)

HW mode with debugger (default):

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode hw
```

Virt mode with debugger:

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode virt
```

HW mode without debugger:

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode hw --no-inspect
```

Passing extra args through to the Node app:

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode hw -- --some-flag value --another-flag
```

Start the CLI against a running Charlie daemon:

```shell
/opt/charlie/charlie/scripts/dev/cli.sh
/opt/charlie/charlie/scripts/dev/cli.sh --host 127.0.0.1 --port 8787
/opt/charlie/charlie/scripts/dev/cli.sh --no-inspect
/opt/charlie/charlie/scripts/dev/cli.sh -- --log-level debug
```


## Result

At this point:
- The Pi has a clean, reproducible runtime
- Native modules are built for ARM
- A single restart script can start hw/virt in debug or non-debug mode
- The system is ready for WebStorm autosync and debugger attach workflow
