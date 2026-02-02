<!-- docs/config/config-rules.md -->
# Rules Config (`config/core/rules.json5`)

Resolved at: `config.core.rules`

---

## Shape (exact)

```js
[
  RuleConfig
]
```

---

## RuleConfig (exact keys)

Required:
- `id: string`
- `priority: number`
- `conditions: Conditions`
- `actions: Actions`

Conditions (exact keys, current):
- `zone: string`
- `weekday: number[]` (1..7)
- `timeRanges: Array<{ start: 'HH:MM', end: 'HH:MM' }>`

Actions (exact keys, current):
- `modePromptId: string`
- `openerPromptId: string`

---

## Example

```js
{
  id: 'front_anytime',
    priority: 10,
    conditions: {
    zone: 'front',
      weekday: [1,2,3,4,5,6,7],
      timeRanges: [{ start: '00:00', end: '24:00' }]
  },
  actions: {
    modePromptId: 'mode.front.any',
      openerPromptId: 'opener.front.any'
  }
}
```
