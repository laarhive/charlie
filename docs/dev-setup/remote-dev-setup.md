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



### Install build tools

```shell
# Do this once
sudo apt install -y build-essential python3 make g++
```


### Install GPIO userspace tools (libgpiod)

Charlie uses **libgpiod userspace tools** for GPIO edge monitoring.
The `gpiomon` binary must be available on the system.



#### Install `libgpiod` tools on the Raspberry Pi:

```shell
sudo apt install -y gpiod
```

This provides:
- `gpiomon`
- `gpioset`
- `gpioget`

Verify availability:

```shell
which gpiomon
gpiomon --version
```

Expected result:
- `gpiomon` resolves to `/usr/bin/gpiomon`
- A version string is printed

If `gpiomon` is missing, hardware GPIO drivers will fail at runtime.



### Configure GPIO access for non-root users (udev)

By default, GPIO character devices (`/dev/gpiochip*`) are owned by `root`
and not accessible to normal users.  
This project requires GPIO access **without sudo**.

The following steps grant safe, group-based access.


#### Create a dedicated `gpio` group (if missing)

```shell
sudo groupadd -f gpio
```


#### Add the project user to the `gpio` group

```shell
sudo usermod -aG gpio charlie
```

>  You **must log out and back in** after this step for group membership to apply.


#### Install udev rule for GPIO character devices

Create a udev rule that assigns GPIO devices to the `gpio` group
with read/write permissions:

```shell
sudo tee /etc/udev/rules.d/60-gpiochip.rules >/dev/null <<'EOF'
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
EOF
```


#### Reload udev rules and apply immediately

```shell
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=gpio
```


#### Log out and log back in

This step is required so the `charlie` user picks up the new group.


#### Verify permissions (must succeed without sudo)

```shell
id
ls -la /dev/gpiochip*
```

Expected result:

- `charlie` is a member of the `gpio` group
- GPIO devices look like:

```text
crw-rw---- 1 root gpio ... /dev/gpiochip0
crw-rw---- 1 root gpio ... /dev/gpiochip1
```


#### Verify `gpiomon` works as non-root

First, inspect the GPIO chip and confirm the target line exists:

```shell
gpioinfo -c gpiochip0
```

You should see line `17` listed (e.g. `GPIO17`) as an input.


##### Monitor a GPIO line for edges (blocking)

Start monitoring line **17** on `gpiochip0`:

```shell
gpiomon -c gpiochip0 --num-events=1 --silent 17 && echo OK
```

This command **blocks** until an edge (rising or falling) occurs.  
This is expected behavior.

Trigger the sensor physically (button press, reed switch, vibration, radar output, etc.).

If an edge is detected, `OK` will print and the command will exit.


##### Optional: software-controlled loopback test (recommended for validation)

If you want to validate edge detection without relying on a sensor:

* Physically connect GPIO16 to GPIO17** with a jumper wire  
   (same voltage domain, no resistor needed for this test).

* In terminal A, monitor GPIO17:

```shell
gpiomon -c gpiochip0 --num-events=1 --silent 17 && echo OK
```

* In terminal B, toggle GPIO16:

```shell
gpioset -c gpiochip0 16=1
gpioset -c gpiochip0 16=0
```

If `OK` prints in terminal A, edge monitoring is fully functional.


##### Notes

- `gpioset` cannot toggle a line that is already monitored by `gpiomon`
- The loopback test avoids this by using **two different GPIO lines**
- Successful detection confirms:
  - udev permissions
  - libgpiod tooling
  - non-root GPIO access
  - edge monitoring reliability


#### Result

- GPIO access works without `sudo`
- Compatible with `libgpiod` / `gpiomon`
- Safe for long-running, non-root services



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
