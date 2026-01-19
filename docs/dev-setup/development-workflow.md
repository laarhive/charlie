# Development Workflow (Local WebStorm + RPi Runtime)

This document describes the **day-to-day development workflow** for Project CHARLIE.

Key principles:
- Code is edited locally (WebStorm)
- Files are synced automatically to the Pi
- The Pi runs the app and hardware
- Debugging is done via SSH + Node inspector
- The Pi remains deterministic and lightweight



## WebStorm: SFTP Auto-Sync Configuration

Enable SFTP auto-upload to the Pi.

### Upload (allowed paths)

- `src/**`
- `config/**`
- `test/**`
- `package.json` (scripts/metadata changes)

### Exclude (important)

These must **never** be auto-synced:

- `.git/**`
- `.yarn/**`
- `.pnp.cjs`
- `.pnp.loader.mjs`
- `.yarnrc.yml`
- `yarn.lock`
- `dist/**`
- `build/**`
- `coverage/**`
- logs / runtime state

Dependency state is updated **only** via Git + Yarn install, never via SFTP.



## Debugging Architecture

- Node inspector runs on the Pi
- Inspector is bound to `127.0.0.1`
- Access is provided via SSH tunnel
- WebStorm attaches locally

This keeps the debug port private and safe.



## Start SSH Tunnel (PC → Pi)

Run this in a terminal on your development machine and keep it open:

```shell
ssh -L 9229:127.0.0.1:9229 charlie@192.168.1.145
```



## One-Click Restart from WebStorm (default: HW mode)

Use the Pi restart script:

```text
/opt/charlie/charlie/scripts/dev-restart.sh
```

Examples (what WebStorm should execute over SSH):

HW mode (debug enabled):

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode hw
```

Virt mode (debug enabled):

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode virt
```

HW mode (no inspector):

```shell
/opt/charlie/charlie/scripts/dev/restart.sh --mode hw --no-inspect
```



## Attach Debugger (WebStorm)

Create once:

- Run → Edit Configurations
- Add **Attach to Node.js/Chrome**
  - Host: `localhost`
  - Port: `9229`



## Manual Restart (Always Available)

If WebStorm is unavailable or misbehaving:

```shell
ssh charlie@<PI_IP>

# Restart in hw mode with inspector
/opt/charlie/charlie/scripts/dev-restart.sh --mode hw

# Or virt mode with inspector
/opt/charlie/charlie/scripts/dev-restart.sh --mode virt

# Or hw mode without inspector
/opt/charlie/charlie/scripts/dev-restart.sh --mode hw --no-inspect
```

Then attach debugger from WebStorm.



## Running Tests

The project uses Mocha via:

```shell
yarn test
```

### Run all tests on the Pi (optional)

```shell
cd /opt/charlie/charlie
yarn test
```

### Run a single test file on the Pi

```shell
cd /opt/charlie/charlie
yarn node ./node_modules/mocha/bin/mocha.js "test/path/to/file.spec.js"
```

If you prefer not to reference `node_modules` with PnP, use Yarn to execute Mocha:

```shell
cd /opt/charlie/charlie
yarn mocha "test/path/to/file.spec.js"
```

If `yarn mocha` is not available as a script, add this script on the dev machine and commit it:

```json
"scripts": {
  "mocha": "mocha"
}
```

Then you can run:

```shell
yarn mocha "test/path/to/file.spec.js"
```

### Run a single test (by name / grep)

Mocha supports filtering with `--grep`:

```shell
cd /opt/charlie/charlie
yarn test -- --grep "should do something"
```

You can also run only tests under a suite name the same way (grep matches suite + test titles).



## Running Tests from WebStorm (local machine)

WebStorm can run Mocha tests locally without the Pi. Typical options:

- Right click a test file → **Run**
- Click the green gutter icon next to:
  - `describe(...)` to run a suite
  - `it(...)` to run a single test
- Use **Run → Edit Configurations → Mocha** to create a reusable config (optional)

This is usually preferred for fast feedback. Use the Pi for hardware validation and end-to-end smoke checks.



## Typical Development Loop

1. Edit files locally in WebStorm
2. Files auto-sync to Pi via SFTP
3. Click WebStorm action: restart (hw/virt)
4. Click **Attach to Node.js**
5. Debug normally (breakpoints, stepping, inspection)



## Ending a Session

- Stop the Node process on the Pi (restart script will replace it next time, or `Ctrl+C` if running in a terminal)
- Close SSH tunnel
- Optionally resync the Pi repo to clean state (see resync doc)


## Running Tests on the Pi (Remote Runtime)

When running tests on the Raspberry Pi, WebStorm cannot trigger individual
`it()` / `describe()` blocks via gutter icons (this only works for local or
Remote-Dev backends).

Instead, tests are executed explicitly via Mocha on the Pi.



### Run all tests on the Pi

```shell
cd /opt/charlie/charlie
yarn test
```



### Run a single test file on the Pi

```shell
cd /opt/charlie/charlie
yarn test test/path/to/file.spec.js
```

Example:

```shell
yarn test test/hw/gpio.spec.js
```



### Run a specific test suite (by `describe` name)

Mocha allows filtering by suite name using `--grep`.
This matches `describe()` titles.

```shell
cd /opt/charlie/charlie
yarn test -- --grep "GPIO initialization"
```

This will run **only** the suite(s) whose `describe()` title matches the string.



### Run a single test (by `it` name)

You can also target a specific test case by matching its `it()` title.

```shell
cd /opt/charlie/charlie
yarn test -- --grep "should initialize GPIO correctly"
```

Only tests whose title matches the string will run.



### Notes on `--grep`

- Matching is substring-based (not exact)
- Case-sensitive by default
- Matches both `describe()` and `it()` titles
- Useful for fast, targeted testing on hardware



### Recommended Practice

- **Local WebStorm**
  - Use gutter icons for fast iteration
  - Run individual tests and suites frequently

- **Raspberry Pi**
  - Run full files or filtered tests (`--grep`)
  - Use Pi only when hardware, timing, or integration matters

This keeps the Pi deterministic and avoids unnecessary runtime overhead.
