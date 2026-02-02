<!-- docs/config/config-controllers-led.md -->
# LED Controller Config (`config/controllers/led.json5`)

Resolved at: `config.controllers.led`

Controller consumes semantic main-bus events and emits `ledRaw:command` on `buses.led`.

---

## LedControllerConfig (exact keys, current)

Required:
- `enabled: boolean`
- `routing: { defaultLedId: string }`
- `patterns: Record<string, Array<{ rgb: [number,number,number], ms: number }>>`
- `rules: Array<{ on: string, do: { pattern: string } }>`

Example:

```js
{
  enabled: true,
    routing: { defaultLedId: 'statusLed1' },

  patterns: {
    off: [{ rgb: [0,0,0], ms: 0 }],
      flashRed: [{ rgb: [255,0,0], ms: 120 }, { rgb: [0,0,0], ms: 0 }]
  },

  rules: [
    { on: 'presence:enter', do: { pattern: 'off' } },
    { on: 'vibration:hit', do: { pattern: 'flashRed' } }
  ]
}
```
