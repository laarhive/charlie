<!-- docs/proposed-structure.md -->

# Proposed docs structure

This replaces the scattered `docs_old/*` layout with a smaller set of current docs.

```
docs/
  README.md
  architecture/
    system-overview.md
    charlie-core.md
    devices.md
    charlie-ai.md
  api/
    ws.md
  rpi/
    deployment-checklist.md
    gpio-libgpiod-setup.md
  cli.md
  configuration.md
  hardware.md
  tasker-endpoints.md
```

Old docs:
- keep `docs_old/` temporarily if you still reference it
- otherwise delete it once the new docs cover what you need
