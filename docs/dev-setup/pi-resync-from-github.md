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

Use this procedure to restore the Raspberry Pi to a **clean, reproducible state**
that exactly matches the `master` branch on GitHub.

```shell
cd /opt/charlie/charlie

# Retrieve the latest commit information without modifying the working tree
git fetch origin

# Force the local repository to exactly match origin/master,
# discarding any SFTP-synced or local changes
git reset --hard origin/master

# Pull Git LFS objects (required for zero-installs)
git lfs pull

# Ensure the local branch is fast-forward aligned (safety check)
# - confirms no accidental divergence
# - no-op if already clean
git pull --ff-only
```



### Prepare the new Yarn version (only if Yarn was updated)

If the `packageManager` field in `package.json` was changed, prepare the
new Yarn version **as the project user (`charlie`)**:

```shell
corepack prepare yarn@4.xx.0 --activate
yarn -v   # must show 4.xx.0
```

If Yarn was not updated, this step can be skipped.



### Reinstall dependencies deterministically

```shell
yarn install --immutable --immutable-cache
```

This will:
- Verify the dependency graph
- Use only the committed `.yarn/cache`
- Rebuild native ARM modules if required
- Fail early if anything is inconsistent



### Ensure all development scripts are executable

Scripts are version-controlled but executable bits may not be preserved
across all environments. Ensure they are executable after a resync:

```shell
cd /opt/charlie/charlie

# Preferred (portable)
find scripts -type f -name "*.sh" -exec chmod +x {} \;
```



### Result

After completing this procedure:

- `git status` is clean
- Repository state exactly matches `origin/master`
- Git LFS objects are present
- Yarn version matches `package.json`
- Dependencies are deterministic
- Development scripts are ready to use

The Pi is now safe for development, debugging, or long-running operation.



## Fast Resync (No Dependency Changes)

If you only changed source files and dependencies did NOT change:

```shell
cd /opt/charlie/charlie
git fetch origin
git reset --hard origin/master

# Ensure all scripts are executable
chmod +x scripts/**/*.sh
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
