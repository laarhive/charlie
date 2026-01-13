# Resyncing the Pi Repository from GitHub

This document explains how to bring the Pi back to a **clean, versioned state**
after development using SFTP autosync.

Use this whenever:
- You changed dependencies
- You want the Pi aligned exactly to `master`
- The working tree is dirty due to autosync



## When to Resync

You should resync when:
- `package.json` dependencies changed
- `.yarn/cache` was updated via Git LFS
- You want a known-good, reproducible state



## Full Resync Procedure (Safe)

```shell
cd /opt/charlie/charlie

# Fetch latest state
git fetch origin

# Hard reset to master
git reset --hard origin/master

# Pull LFS objects (required for zero-installs)
git lfs pull

# Reinstall dependencies deterministically
yarn install --immutable --immutable-cache
```

This will:
- Discard any SFTP-synced changes
- Restore the exact repository state
- Ensure dependency cache is complete
- Rebuild native ARM modules if needed



## Fast Resync (No Dependency Changes)

If you only changed source files and dependencies did NOT change:

```shell
cd /opt/charlie/charlie
git fetch origin
git reset --hard origin/master
```

No Yarn install is needed in this case.



## Important Rules

- Never commit from the Pi
- Never edit `.yarn/**` on the Pi manually
- Never autosync `.yarn/**` via SFTP
- Dependency changes always originate on the dev machine



## Result

After resync:
- Pi is clean (`git status` is empty)
- Runtime is reproducible
- Safe for long-running or unattended operation
