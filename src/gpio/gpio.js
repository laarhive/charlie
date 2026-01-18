// src/hw/gpio/gpio.js
import { EventEmitter } from 'node:events'
import GpioBackend from './gpioBackend.js'

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
   * Create a GPIO line wrapper backed by libgpiod CLI tools via GpioBackend.
   *
   * Notes:
   * - Monitoring (gpiomon) starts lazily when you attach 'edge' or 'interrupt' listeners.
   * - Output driving uses a per-line "hog" process: digitalWrite(1) holds HIGH, digitalWrite(0) releases.
   * - The backend sets a consumer name so `gpioinfo` shows who owns the line.
   * - If reclaimOnBusy is enabled, the backend may auto-reclaim orphaned lines owned by your consumerTag.
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
   * led.digitalWrite(1) // LED on (hog holds HIGH)
   * setTimeout(() => led.digitalWrite(0), 1000) // LED off (hog released)
   *
   * @example
   * // Button input with pull-down + edge events
   * import Gpio from './gpio.js'
   *
   * const button = new Gpio(4, {
   *   mode: Gpio.INPUT,
   *   pullUpDown: Gpio.PULL_DOWN,
   *   edge: Gpio.EITHER_EDGE,
   *   consumerTag: 'charlie',
   * })
   *
   * button.on('interrupt', ({ level, tick }) => {
   *   console.log('button level=', level, 'tick=', tick)
   * })
   *
   * @param {number} line GPIO line offset (e.g. 17 for GPIO17 on gpiochip0)
   * @param {object} [opts]
   * @param {'in'|'out'} [opts.mode] Gpio.INPUT or Gpio.OUTPUT
   * @param {string} [opts.pullUpDown] Pull config: Gpio.PULL_DOWN | Gpio.PULL_UP | Gpio.PULL_OFF
   * @param {'rising'|'falling'|'either'} [opts.edge] Edge filter applied in JS
   * @param {object} [opts.logger] Logger with .error() for non-fatal backend errors
   * @param {object} [opts.clock] Clock with nowMs() used for tick timestamps
   *
   * @param {string} [opts.chip] GPIO chip name (default gpiochip0)
   * @param {string} [opts.binDir] Directory containing libgpiod tools (default /usr/bin)
   * @param {string} [opts.gpiomonPath] Override full path to gpiomon
   * @param {string} [opts.gpiosetPath] Override full path to gpioset
   * @param {string} [opts.gpioinfoPath] Override full path to gpioinfo
   * @param {string} [opts.pkillPath] Override full path to pkill (needed for reclaimOnBusy)
   *
   * @param {string} [opts.consumerTag] Consumer tag used for --consumer (shown by gpioinfo)
   * @param {boolean} [opts.reclaimOnBusy] If true, auto-reclaim busy lines owned by this consumerTag
   *
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
   * Semantics (libgpiod CLI friendly):
   * - digitalWrite(1): starts/keeps a "hog" process holding the line HIGH
   * - digitalWrite(0): stops the hog (releases the line), allowing pull-down/bias to define LOW
   *
   * @example
   * const led = new Gpio(17, { mode: Gpio.OUTPUT, consumerTag: 'charlie' })
   * led.digitalWrite(1)
   * setTimeout(() => led.digitalWrite(0), 500)
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
   * @example
   * const pin = new Gpio(4, { mode: Gpio.INPUT })
   * // pin.digitalRead() // throws for now
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
   * @example
   * const pin = new Gpio(17)
   * pin.mode(Gpio.OUTPUT).digitalWrite(1)
   *
   * @param {'in'|'out'} mode
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
   * @example
   * const btn = new Gpio(4, { mode: Gpio.INPUT })
   * btn.edge(Gpio.RISING_EDGE)
   *
   * @param {'rising'|'falling'|'either'} edge
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
   * (Underlying backend line state is shared; monitors stop automatically when listeners are removed.)
   *
   * @example
   * const pin = new Gpio(17)
   * pin.dispose()
   */
  dispose() {
    this.removeAllListeners()
  }

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
