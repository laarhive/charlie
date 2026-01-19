# GPIO Library (libgpiod CLI backend)

This GPIO module provides a small Node.js wrapper around Linux **libgpiod CLI tools**.

It supports:
- Input edge monitoring via `gpiomon`
- Output driving via `gpioset` “hog” semantics
- Consumer tagging (visible in `gpioinfo`)
- Optional “reclaim on busy” behavior to recover orphaned hog/monitor processes created by this app

Source files:
- `src/hw/gpio/gpio.js` (public wrapper)
- `src/hw/gpio/gpioBackend.js` (shared backend + per-line state)

---

## Requirements

Your system must have these binaries executable:
- `gpiomon`
- `gpioset`
- `gpioinfo`

Defaults assume they are in `/usr/bin`.

If you enable reclaim-on-busy, you also need:
- `pkill`

---

## Concepts

### Line number
All APIs use a **numeric line offset** (e.g. `17`) on a GPIO chip (default `gpiochip0`).

### Monitoring (inputs)
- Monitoring starts **lazily** when you attach an `'edge'` or `'interrupt'` listener.
- It is implemented by spawning `gpiomon` and parsing stdout lines.
- Monitoring stops automatically when the last `'edge'/'interrupt'` listener is removed.

### Output driving (hog semantics)
`digitalWrite()` uses `gpioset` in a “hog” style:

- `digitalWrite(1)` starts/keeps a `gpioset` process that holds the line HIGH
- `digitalWrite(0)` stops the hog process, releasing the line

This is intentionally CLI-friendly and makes it easy to understand ownership using `gpioinfo`.

---

## Public API: `Gpio`

Import:
```js
import Gpio from './src/hw/gpio/gpio.js'
```

### Constructor

```js
const pin = new Gpio(line, opts, backend)
```

Inputs:
- `line` (number): GPIO line offset, e.g. `17`
- `opts` (object, optional): configuration
- `backend` (GpioBackend|null, optional): advanced/testing use

Output:
- a `Gpio` instance (EventEmitter)

### Options (`opts`)

Common options:
- `mode`: `'in'` or `'out'` (`Gpio.INPUT`, `Gpio.OUTPUT`)
- `pullUpDown`: `'pull-down' | 'pull-up' | 'disable'` (plus alias strings like `"down"`, `"up"`, `"off"`, etc.)
- `edge`: `'rising' | 'falling' | 'either'` (JS-side filter)

Backend/tooling options:
- `chip` (default: `"gpiochip0"`)
- `binDir` (default: `"/usr/bin"`)
- `gpiomonPath`, `gpiosetPath`, `gpioinfoPath`, `pkillPath` (optional overrides)

Ownership + reclaim:
- `consumerTag`: string used to generate `--consumer` values
- `reclaimOnBusy`: boolean (requires `consumerTag`)

Logging/time:
- `logger`: object with optional `logger.error(eventName, data)`
- `clock`: object with `nowMs()` used for `tick` values

---

## Events

### `'interrupt'` and `'edge'`

Both events emit the same payload:

```js
{
  level: 0 | 1 | 2,
  tick: number,
  raw: string
}
```

Fields:
- `level`
  - `0`: falling / LOW
  - `1`: rising / HIGH
  - `2`: unknown/unparsed (passes through)
- `tick`: 32-bit unsigned millisecond timestamp
- `raw`: raw parsed `gpiomon` stdout line

Example:
```js
const button = new Gpio(4, {
  mode: Gpio.INPUT,
  pullUpDown: Gpio.PULL_DOWN,
  edge: Gpio.EITHER_EDGE,
  consumerTag: 'charlie'
})

button.on('interrupt', ({ level, tick, raw }) => {
  console.log('level=', level, 'tick=', tick, 'raw=', raw)
})
```

### `'error'`

Error payload:
```js
{
  source: string,
  message: string
}
```

Typical `source` values:
- `'gpiomon'`
- `'gpioset'`

Example:
```js
const pin = new Gpio(17, { mode: Gpio.OUTPUT, consumerTag: 'charlie' })

pin.on('error', (e) => {
  console.error('gpio error', e.source, e.message)
})
```

Default behavior when you do NOT attach an `'error'` listener:
- Errors will not crash the process.
- If you provided `opts.logger.error`, the module logs `gpio_error_unhandled` with details.

---

## Methods

### `digitalWrite(level)`

Input:
- `level`: `0` or `1`

Output:
- returns `this` for chaining

Semantics:
- `1` => start/keep `gpioset` hog holding HIGH
- `0` => stop hog (release line)

Example:
```js
const led = new Gpio(17, { mode: Gpio.OUTPUT, consumerTag: 'charlie' })
led.digitalWrite(1)
setTimeout(() => led.digitalWrite(0), 500)
```

### `digitalRead()`

Status:
- not implemented yet (currently throws)

### `mode(mode)`

Input:
- `'in' | 'out'`

Output:
- returns `this`

### `pullUpDown(pull)`

Input:
- pull value or alias string

Output:
- returns `this`

### `edge(edge)`

Input:
- `'rising' | 'falling' | 'either'`

Output:
- returns `this`

### `dispose()`

Removes all listeners from the wrapper.
Backend state is shared; monitors stop automatically when listeners are removed.

---

## Backend API: `GpioBackend`

You usually do not need to touch the backend directly because `Gpio` uses `GpioBackend.getDefault()` internally.

If you do want to share a backend explicitly (e.g. tests):
```js
import GpioBackend from './src/hw/gpio/gpioBackend.js'
import Gpio from './src/hw/gpio/gpio.js'

const backend = GpioBackend.getDefault({ consumerTag: 'charlie' })

const a = new Gpio(17, { mode: Gpio.OUTPUT }, backend)
const b = new Gpio(17, { mode: Gpio.OUTPUT }, backend)
``
