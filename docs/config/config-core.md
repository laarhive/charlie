<!-- docs/config/config-core.md -->
# Core Config

Core config is split under `config/core/` and merged under `config.core`.

---

## `config/core/core.json5` → `config.core.base`

### CoreBaseConfig (exact keys)

Required:
- `armingDelayMs: number`
- `cooldownMs: number`
- `injectDefaults: InjectDefaults`

InjectDefaults (exact keys):
- `presenceFront: string`
- `presenceBack: string`
- `vibrationLow: string`
- `vibrationHigh: string`
- `buttonShort: string`
- `buttonLong: string`

Example:

```js
{
  armingDelayMs: 1200,
  cooldownMs: 60000,
  injectDefaults: {
    presenceFront: 'presence.front',
    presenceBack: 'presence.back',
    vibrationLow: 'vibration.light',
    vibrationHigh: 'vibration.heavy',
    buttonShort: 'button1',
    buttonLong: 'button1'
  }
}
```

---

## `config/core/rules.json5` → `config.core.rules`

See `docs/config/config-rules.md`

## `config/core/tasker.json5` → `config.core.tasker`

See `docs/config/config-tasker.md`

## `config/core/promptText.json5` → `config.core.promptText`

See `docs/config/config-promptText.md`
