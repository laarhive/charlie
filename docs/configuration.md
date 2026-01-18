# docs/configuration.md

# Configuration

Charlie uses a single JSON5 config file.

Location:
```text
config/defaultConfig.json5
```

## Activation profiles (`--mode`)

Devices are selected by activation profile.

A device is loaded only if:
- `device.modes` includes the current mode

A device starts only if:
- `device.state === "active"`

Devices not included in the current mode are ignored.

## Top-level sections

### `devices[]`
Each entry defines one device instance.

Required fields:
- `id`
- `kind`
- `domain`
- `modes`
- `state` (`active` or `manualBlocked`)
- `protocol` (protocol-specific config)

Optional:
- `publishAs`
- `coreRole`
- `params`

Example:
```js
{
  devices: [
    {
      id: "buttonVirt1",
      publishAs: "button1",
      kind: "buttonEdge",
      domain: "button",
      modes: ["win11"],
      state: "active",
      protocol: { type: "virt", initial: false },
      coreRole: "button.service"
    }
  ]
}
```

### `core`
Core runtime behavior and semantic injection defaults.

Common fields:
- `armingDelayMs`
- `cooldownMs`
- `injectDefaults` (used by CLI semantic injection)

Example:
```js
{
  core: {
    injectDefaults: {
      presenceFront: "presence.front",
      presenceBack: "presence.back",
      vibrationLow: "vibration.light",
      vibrationHigh: "vibration.heavy",
      buttonShort: "button.service",
      buttonLong: "button.service"
    }
  }
}
```

### `rules[]`
Defines behavior rules (core logic). This doc does not define rule schema yet.

### `tasker`
Defines how Core reaches Tasker (phone side).

See:
- `docs/tasker-endpoints.md`
