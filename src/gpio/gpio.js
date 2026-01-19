// src/hw/gpio/gpio.js
import { EventEmitter } from 'node:events'
import GpioBackend from './gpioBackend.js'

/**
 * @typedef {'in'|'out'} GpioMode
 */

/**
 * @typedef {'disable'|'pull-up'|'pull-down'|'as-is'} GpioPull
 */

/**
 * @typedef {'rising'|'falling'|'either'} GpioEdge
 */

/**
 * @typedef {object} GpioClock
 * @property {() => number} nowMs Returns a millisecond timestamp (number). Used to compute a 32-bit tick.
 */

/**
 * @typedef {object} GpioLogger
 * @property {(eventName: string, data?: any) => void} [error] Logs non-fatal errors emitted by the backend when no user 'error' listeners exist.
 */

/**
 * Options for {@link Gpio}.
 *
 * @typedef {object} GpioOptions
 * @property {GpioMode} [mode] Line mode. Use {@link Gpio.INPUT} or {@link Gpio.OUTPUT}.
 * @property {string} [pullUpDown] Pull/bias configuration. Accepted values include:
 * - {@link Gpio.PULL_DOWN}, {@link Gpio.PULL_UP}, {@link Gpio.PULL_OFF}
 * - aliases like "down", "up", "off", "none", "pull-down", "pull-up", "disable"
 * @property {GpioEdge} [edge] Edge filter applied in JS. Default: {@link Gpio.EITHER_EDGE}.
 *
 * @property {GpioLogger} [logger] Optional logger. If no user 'error' listeners exist, backend errors are forwarded to logger.error (if present).
 * @property {GpioClock} [clock] Optional clock used for the tick value (32-bit unsigned).
 *
 * @property {string} [chip] GPIO chip name, default "gpiochip0".
 * @property {string} [binDir] Directory containing libgpiod tools, default "/usr/bin".
 * @property {string} [gpiomonPath] Override full path to "gpiomon".
 * @property {string} [gpiosetPath] Override full path to "gpioset".
 * @property {string} [gpioinfoPath] Override full path to "gpioinfo".
 * @property {string} [pkillPath] Override full path to "pkill" (only needed when reclaimOnBusy=true).
 *
 * @property {string} [consumerTag] Consumer tag used for libgpiod "--consumer". This is visible in `gpioinfo`.
 * @property {boolean} [reclaimOnBusy] If true, the backend may reclaim orphaned processes *owned by your consumerTag* when the line is busy.
 */

/**
 * Edge/interrupt payload emitted by {@link Gpio} (and by the internal line state).
 *
 * @typedef {object} GpioInterruptEvent
 * @property {0|1|2} level
 * - 0: falling edge / LOW
 * - 1: rising edge / HIGH
 * - 2: unknown/unparsed (passes through)
 * @property {number} tick 32-bit unsigned millisecond timestamp.
 * @property {string} raw The raw `gpiomon` line that produced this event.
 */

/**
 * Error payload emitted by {@link Gpio}.
 *
 * @typedef {object} GpioErrorEvent
 * @property {'gpiomon'|'gpioset'|string} source Subsystem name that raised the error.
 * @property {string} message Human-readable message, often stderr content.
 */

/**
 * GPIO line wrapper backed by libgpiod CLI tools via {@link GpioBackend}.
 *
 * Emits:
 * - `'edge'` with {@link GpioInterruptEvent}
 * - `'interrupt'` with {@link GpioInterruptEvent} (alias of `'edge'`)
 * - `'error'` with {@link GpioErrorEvent}
 *
 * Monitoring behavior:
 * - `gpiomon` starts lazily when you add an `'edge'` or `'interrupt'` listener.
 * - `gpiomon` stops when the last `'edge'/'interrupt'` listener is removed.
 *
 * Output behavior (hog semantics):
 * - `digitalWrite(1)` starts/keeps a `gpioset` "hog" holding the line HIGH.
 * - `digitalWrite(0)` stops the hog, releasing the line (allowing bias/pull to define LOW).
 *
 * @example
 * // Simple output LED (hold-high / release-low)
 * import Gpio from './gpio.js'
 *
 * const led = new Gpio(17, {
 *   mode: Gpio.OUTPUT,
 *   consumerTag: 'charlie',
 *   reclaimOnBusy: true
 * })
 *
 * led.digitalWrite(1)
 * setTimeout(() => led.digitalWrite(0), 1000)
 *
 * @example
 * // Button input with pull-down + edge events
 * import Gpio from './gpio.js'
 *
 * const button = new Gpio(4, {
 *   mode: Gpio.INPUT,
 *   pullUpDown: Gpio.PULL_DOWN,
 *   edge: Gpio.EITHER_EDGE,
 *   consumerTag: 'charlie'
 * })
 *
 * button.on('interrupt', ({ level, tick }) => {
 *   console.log('button level=', level, 'tick=', tick)
 * })
 */
export class Gpio extends EventEmitter {
  static INPUT = 'in'
  static OUTPUT = 'out'

  static PULL_OFF = 'disable'
  static PULL_UP = 'pull-up'
  static PULL_DOWN = 'pull-down'

  static RISING_EDGE = 'rising'
  static FALLING_EDGE = 'falling'
  static EITHER_EDGE = 'either'

  static TIMEOUT = 2

  #lineState
  #line
  #logger

  #mode
  #pull
  #edge

  /* userListenerKey -> bridgedListener */
  #bridges

  /* keep backend errors from crashing when no 'error' listeners exist */
  #defaultErrorBridgeInstalled

  /**
   * Create a GPIO wrapper for one line offset on a gpio chip.
   *
   * Inputs:
   * - `line`: numeric GPIO line offset (e.g. 17 for GPIO17 on gpiochip0)
   * - `opts`: configuration options (mode, pull, edge filter, backend paths, consumer tagging, reclaim behavior)
   * - `backend`: optional explicit backend instance (advanced/testing)
   *
   * Outputs:
   * - Returns a {@link Gpio} instance (EventEmitter). No async work is started until you:
   *   - call {@link Gpio#digitalWrite} (spawns gpioset hog as needed)
   *   - attach `'edge'/'interrupt'` listeners (spawns gpiomon monitor)
   *
   * @example
   * import Gpio from './gpio.js'
   *
   * const pin = new Gpio(17, { mode: Gpio.OUTPUT, consumerTag: 'charlie' })
   * pin.digitalWrite(1)
   *
   * @param {number} line GPIO line offset (e.g. 17 for GPIO17 on gpiochip0)
   * @param {GpioOptions} [opts]
   * @param {GpioBackend|null} [backend] Optional explicit backend instance (advanced)
   */
  constructor(line, opts = {}, backend = null) {
    super()

    this.#line = Number(line)
    if (Number.isNaN(this.#line)) {
      throw new Error('Gpio(line) requires numeric line')
    }

    this.#logger = opts?.logger ?? null

    const resolvedBackend = backend || GpioBackend.getDefault({
      logger: opts?.logger,
      clock: opts?.clock,
      chip: opts?.chip,
      binDir: opts?.binDir,
      gpiomonPath: opts?.gpiomonPath,
      gpiosetPath: opts?.gpiosetPath,
      gpioinfoPath: opts?.gpioinfoPath,
      pkillPath: opts?.pkillPath,
      consumerTag: opts?.consumerTag,
      reclaimOnBusy: opts?.reclaimOnBusy,
    })

    this.#lineState = resolvedBackend.getLine(this.#line)

    this.#mode = opts?.mode ?? null
    this.#pull = this.#mapPull(opts?.pullUpDown ?? opts?.pull ?? null)
    this.#edge = this.#mapEdge(opts?.edge ?? null)

    this.#bridges = new Map()
    this.#defaultErrorBridgeInstalled = false

    this.#applyConfig()
    this.#installDefaultErrorBridge()
  }

  /**
   * Set output level.
   *
   * Input:
   * - `level`: 0 or 1 (number). Other numeric values are rejected.
   *
   * Output:
   * - Returns `this` for chaining.
   *
   * Side effects:
   * - `1` spawns/keeps a `gpioset` hog holding HIGH.
   * - `0` stops the hog (releases the line).
   *
   * @example
   * const led = new Gpio(17, { mode: Gpio.OUTPUT, consumerTag: 'charlie' })
   * led.digitalWrite(1).digitalWrite(0)
   *
   * @param {0|1|number} level 0 or 1
   * @returns {Gpio} this
   */
  digitalWrite(level) {
    this.#lineState.digitalWrite(level)
    return this
  }

  /**
   * Read input level (not implemented yet; intended to be backed by gpioget).
   *
   * Input:
   * - none
   *
   * Output:
   * - (planned) 0 or 1
   * - (current) always throws
   *
   * @example
   * const pin = new Gpio(4, { mode: Gpio.INPUT })
   * try {
   *   pin.digitalRead()
   * } catch (e) {
   *   console.error('not implemented', e.message)
   * }
   *
   * @throws {Error} Always (until implemented)
   * @returns {0|1} level
   */
  digitalRead() {
    return this.#lineState.digitalRead()
  }

  /**
   * Update mode (INPUT/OUTPUT) for this line.
   *
   * Input:
   * - `mode`: 'in' or 'out'
   *
   * Output:
   * - Returns `this` for chaining.
   *
   * @example
   * const pin = new Gpio(17)
   * pin.mode(Gpio.OUTPUT).digitalWrite(1)
   *
   * @param {GpioMode} mode
   * @returns {Gpio} this
   */
  mode(mode) {
    this.#mode = mode
    this.#applyConfig()
    return this
  }

  /**
   * Update pull configuration (bias) used by gpiomon.
   *
   * Input:
   * - `pull`: pull value or alias string. Unrecognized values become "as-is".
   *
   * Output:
   * - Returns `this` for chaining.
   *
   * @example
   * const btn = new Gpio(4, { mode: Gpio.INPUT })
   * btn.pullUpDown(Gpio.PULL_DOWN)
   *
   * @param {string} pull Pull config
   * @returns {Gpio} this
   */
  pullUpDown(pull) {
    this.#pull = this.#mapPull(pull)
    this.#applyConfig()
    return this
  }

  /**
   * Update edge filter used by this wrapper (applied in JS).
   *
   * Input:
   * - `edge`: 'rising' | 'falling' | 'either'
   *
   * Output:
   * - Returns `this` for chaining.
   *
   * Note:
   * - libgpiod `gpiomon` is started without an explicit edge filter; filtering is applied here.
   *
   * @example
   * const btn = new Gpio(4, { mode: Gpio.INPUT })
   * btn.edge(Gpio.RISING_EDGE)
   *
   * @param {GpioEdge} edge
   * @returns {Gpio} this
   */
  edge(edge) {
    this.#edge = this.#mapEdge(edge)
    this.#applyConfig()
    return this
  }

  /**
   * Get the numeric line offset.
   *
   * Output:
   * - Returns the line offset you constructed this instance with.
   *
   * @example
   * const pin = new Gpio(17)
   * console.log(pin.getLine())
   *
   * @returns {number}
   */
  getLine() {
    return this.#line
  }

  /**
   * Dispose this wrapper instance.
   *
   * Output:
   * - Returns void.
   *
   * Side effects:
   * - Removes all listeners from this wrapper.
   * - Backend line state is shared; monitors stop automatically when listeners are removed.
   *
   * @example
   * const pin = new Gpio(17)
   * pin.dispose()
   */
  dispose() {
    this.removeAllListeners()
  }

  /**
   * Attach event listeners.
   *
   * Special behavior:
   * - For `'edge'/'interrupt'/'error'`, listeners are bridged from the shared backend line state,
   *   and `'edge'/'interrupt'` will start the monitor lazily.
   *
   * Output:
   * - Returns `this` (EventEmitter convention).
   *
   * @example
   * const pin = new Gpio(4, { mode: Gpio.INPUT })
   * pin.on('interrupt', (evt) => console.log(evt.level, evt.tick))
   *
   * @param {string} eventName
   * @param {Function} listener
   * @returns {this}
   */
  on(eventName, listener) {
    if (eventName === 'edge' || eventName === 'interrupt') {
      this.#attachBridge(eventName, listener)
      return super.on(eventName, listener)
    }

    if (eventName === 'error') {
      this.#attachBridge('error', listener)
      return super.on('error', listener)
    }

    return super.on(eventName, listener)
  }

  /**
   * Detach an event listener.
   *
   * Output:
   * - Returns `this`.
   *
   * @example
   * const fn = (e) => console.log(e)
   * pin.on('error', fn)
   * pin.off('error', fn)
   *
   * @param {string} eventName
   * @param {Function} listener
   * @returns {Gpio}
   */
  off(eventName, listener) {
    if (eventName === 'edge' || eventName === 'interrupt' || eventName === 'error') {
      super.off(eventName, listener)
      this.#detachBridge(eventName, listener)
      return this
    }

    super.off(eventName, listener)
    return this
  }

  removeListener(eventName, listener) {
    return this.off(eventName, listener)
  }

  /**
   * Remove listeners.
   *
   * Input:
   * - If `eventName` is omitted: removes all listeners of all events.
   * - If `eventName` is specified: removes all listeners for that event.
   *
   * Output:
   * - Returns `this`.
   *
   * @example
   * pin.removeAllListeners('interrupt')
   *
   * @param {string} [eventName]
   * @returns {Gpio}
   */
  removeAllListeners(eventName) {
    if (!eventName) {
      for (const [key, bridged] of this.#bridges.entries()) {
        if (key === '__default_error_bridge__') continue
        const [evt] = key.split(':')
        this.#lineState.off(evt, bridged)
      }
      this.#bridges.clear()

      super.removeAllListeners()
      this.#installDefaultErrorBridge()
      return this
    }

    if (eventName === 'edge' || eventName === 'interrupt' || eventName === 'error') {
      const listeners = this.listeners(eventName)
      super.removeAllListeners(eventName)

      for (const l of listeners) {
        this.#detachBridge(eventName, l)
      }

      return this
    }

    super.removeAllListeners(eventName)
    return this
  }

  #attachBridge(eventName, userListener) {
    const key = `${eventName}:${userListener}`
    if (this.#bridges.has(key)) return

    if (eventName === 'error') {
      const bridged = (evt) => {
        this.emit('error', evt)
      }

      this.#bridges.set(key, bridged)
      this.#lineState.on('error', bridged)
      return
    }

    const bridged = (evt) => {
      this.emit(eventName, evt)
    }

    this.#bridges.set(key, bridged)
    this.#lineState.on(eventName, bridged)
  }

  #detachBridge(eventName, userListener) {
    const key = `${eventName}:${userListener}`
    const bridged = this.#bridges.get(key)
    if (!bridged) return

    this.#bridges.delete(key)

    if (eventName === 'error') {
      this.#lineState.off('error', bridged)
      return
    }

    this.#lineState.off(eventName, bridged)
  }

  #installDefaultErrorBridge() {
    if (this.#defaultErrorBridgeInstalled) return

    const bridged = (evt) => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', evt)
        return
      }

      if (this.#logger?.error) {
        this.#logger.error('gpio_error_unhandled', {
          line: this.#line,
          source: evt?.source,
          message: evt?.message
        })
      }
    }

    this.#bridges.set('__default_error_bridge__', bridged)
    this.#lineState.on('error', bridged)
    this.#defaultErrorBridgeInstalled = true
  }

  #applyConfig() {
    this.#lineState.configure({
      mode: this.#mode,
      pull: this.#pull,
      edge: this.#edge,
    })
  }

  #mapPull(pullUpDown) {
    if (pullUpDown === null || pullUpDown === undefined) return 'as-is'

    const s = String(pullUpDown).trim().toLowerCase()
    if (!s) return 'as-is'

    if (s === 'down' || s === 'pulldown' || s === 'pull-down' || s === 'pud_down') return Gpio.PULL_DOWN
    if (s === 'up' || s === 'pullup' || s === 'pull-up' || s === 'pud_up') return Gpio.PULL_UP
    if (s === 'off' || s === 'none' || s === 'disable' || s === 'pud_off') return Gpio.PULL_OFF

    return 'as-is'
  }

  #mapEdge(edge) {
    if (edge === null || edge === undefined) return Gpio.EITHER_EDGE

    const s = String(edge).trim().toLowerCase()
    if (!s) return Gpio.EITHER_EDGE

    if (s === 'rising' || s === 'rising_edge' || s === 'rising-edge') return Gpio.RISING_EDGE
    if (s === 'falling' || s === 'falling_edge' || s === 'falling-edge') return Gpio.FALLING_EDGE
    if (s === 'either' || s === 'both' || s === 'either_edge' || s === 'either-edge') return Gpio.EITHER_EDGE

    return Gpio.EITHER_EDGE
  }
}

export default Gpio
