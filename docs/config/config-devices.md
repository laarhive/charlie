<!-- docs/config/devices.md -->
# Devices Config (`config/devices/devices.json5`)

Defines device instances. Devices contain protocol/IO config only (no policy).

---

## Shape (exact)

Top-level is an array:

```js
[
  DeviceConfig
]
```

---

## DeviceConfig (exact keys)

Required:
- `id: string`
- `kind: string`
- `domain: string`

Optional:
- `publishAs: string` (default: `id`)
- `role: string` (sensors only)
- `state: 'active' | 'manualBlocked'` (initial)
- `modes: string[]`
- `protocol: object` (kind-specific)
- `params: object` (kind-specific)

---

## Examples

### ws2812 LED (actuator)
```js
{
  id: 'statusLed1',
  publishAs: 'statusLed',
  domain: 'led',
  kind: 'ws2812Led',
  protocol: {
    type: 'serial',
    usbId: { vid: '2e8a', pid: '101f', serial: '6&68C07EB&0&0002' },
    baudRate: 256000,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  },
  modes: ['rpi4', 'win11'],
  state: 'active'
}
```

### ld2450 radar pinned to hub port (Windows, Debian)
```js
{
  id: 'ch340A',
  domain: 'example',
  kind: 'exampleKind',
  protocol: {
    type: 'serial',
    usbId: { vid: '1a86', pid: '7523', hubPosition: '3' },
    baudRate: 115200
  }
}
```

### ld2450 radar (sensor)
```js
{
  id: 'LD2450A',
    publishAs: 'LD2450A',
    domain: 'presence',
    kind: 'ld2450Radar',
    protocol: {
    type: 'serial',
      usbId: { vid: '10c4', pid: 'ea60', serial: 'CP2102-93-LD2450A' },
    baudRate: 256000,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      highWaterMark: 2400
  },
  modes: ['rpi4', 'win11'],
    state: 'active'
}
```
