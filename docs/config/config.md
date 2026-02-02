// docs/config/config.md
# Config System

Entry file: `config/defaultConfig.json5` (JSON5)

Runtime uses a **single resolved config object** produced by:
- keyed `include`
- deep merge (objects)
- array replace (arrays)

---

## Directory layout

- `config/defaultConfig.json5` (entry)
- `config/devices/devices.json5`
- `config/core/core.json5`
- `config/core/rules.json5`
- `config/core/tasker.json5`
- `config/core/promptText.json5`
- `config/controllers/*.json5`

---

## Include format

Leaf values are file paths. Nested objects represent nested keys.

Example:

```js
{
  include: {
    devices: './devices/devices.json5',

    core: {
      base: './core/core.json5',
      rules: './core/rules.json5',
      tasker: './core/tasker.json5',
      promptText: './core/promptText.json5',
    },

    controllers: {
      presence: './controllers/presence.json5',
      led: './controllers/led.json5',
      vibration: './controllers/vibration.json5',
      button: './controllers/button.json5',
    },
  }
}
```

---

## Merge rules

- objects: deep merge
- arrays: replace
- primitives: override
- null: explicit clear

---

## Final resolved config shape (exact top-level keys)

```js
{
  devices: Array<DeviceConfig>,

    core: {
    base: CoreBaseConfig,
      rules: Array<RuleConfig>,
      tasker: TaskerConfig,
      promptText: PromptTextConfig,
  },

  controllers: {
    presence: PresenceControllerConfig,
      led: LedControllerConfig,
      vibration: VibrationControllerConfig,
      button: ButtonControllerConfig,
  },
}
```
