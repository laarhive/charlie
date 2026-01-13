# Development Setup (RPi Runtime)

## Documentation

- **[Remote environment setup (RPi)](remote-dev-setup.md)**  
  Install Node.js, clone the repository, pull LFS objects, install dependencies, and set up restart scripts.

- **[Development workflow](development-workflow.md)**  
  WebStorm autosync, SSH tunnel, one-click restart, remote debugging, and running tests locally or on the Pi.

- **[Resync Pi from GitHub](pi-resync-from-github.md)**  
  Restore the Pi to a clean, reproducible state after dependency or code changes.



## Overview

This folder documents how to develop **Project CHARLIE** with:

- Local WebStorm for editing and test authoring
- Raspberry Pi as a **runtime and debugging target**
- Yarn Berry + PnP + zero-installs
- SSH + Node Inspector for remote debugging

The Pi is intentionally **not** used as a development workstation.
No IDE backend or indexing runs on the Pi.

