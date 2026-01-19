// src/hw/gpio/gpioBackend.js
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

let processExitBound = false
const activeBackends = new Set()

const bindProcessExitOnce = function bindProcessExitOnce() {
  if (processExitBound) return
  processExitBound = true

  const cleanupAll = () => {
    for (const backend of Array.from(activeBackends)) {
      try {
        backend.dispose()
      } catch {}
    }
  }

  process.on('exit', cleanupAll)
  process.on('SIGINT', () => {
    cleanupAll()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    cleanupAll()
    process.exit(143)
  })
}

/**
 * @typedef {object} BackendClock
 * @property {() => number} [nowMs] Returns a millisecond timestamp (number). If omitted, Date.now() is used.
 */

/**
 * @typedef {object} BackendLogger
 * @property {(eventName: string, data?: any) => void} [error] Optional structured logging hook for non-fatal backend issues.
 */

/**
 * @typedef {object} GpioBackendOptions
 * @property {BackendLogger} [logger] Logger used for internal errors (e.g. pkill failures).
 * @property {BackendClock} [clock] Optional clock used for tick generation.
 *
 * @property {string} [chip='gpiochip0'] gpio chip name passed to libgpiod (`-c <chip>`).
 * @property {string} [binDir='/usr/bin'] directory containing `gpiomon`, `gpioset`, `gpioinfo`.
 * @property {string|null} [gpiomonPath=null] override full path to gpiomon.
 * @property {string|null} [gpiosetPath=null] override full path to gpioset.
 * @property {string|null} [gpioinfoPath=null] override full path to gpioinfo.
 * @property {string|null} [pkillPath=null] override full path to pkill (required when reclaimOnBusy=true).
 *
 * @property {string|null} [consumerTag=null] tag used to generate `--consumer` values shown by `gpioinfo`.
 * @property {boolean} [reclaimOnBusy=false] enable reclaim attempts when gpioset reports the line is busy.
 */

/**
 * Backend wrapper around libgpiod CLI tools.
 *
 * Responsibilities:
 * - Share per-line state across multiple {@link Gpio} instances (same line number).
 * - Lazily start/stop monitors (gpiomon) based on listener counts.
 * - Drive outputs using gpioset hog processes.
 * - Optionally reclaim orphaned hog/monitor processes if the line is busy and the consumerTag matches.
 *
 * Notes:
 * - This class exposes `getLine()` which returns a shared internal line state object (EventEmitter).
 * - `dispose()` stops all active monitors and hogs started through this backend.
 */
export class GpioBackend {
  static #defaultInstance = null

  /**
   * Get (or create) the shared default backend instance.
   *
   * Inputs:
   * - A configuration object that defines chip/tool paths/consumerTag.
   *
   * Output:
   * - A singleton {@link GpioBackend} instance.
   *
   * @example
   * import GpioBackend from './gpioBackend.js'
   *
   * const backend = GpioBackend.getDefault({
   *   consumerTag: 'charlie',
   *   reclaimOnBusy: true
   * })
   *
   * @param {GpioBackendOptions} [opts]
   * @returns {GpioBackend}
   */
  static getDefault({
                      logger,
                      clock,
                      chip = 'gpiochip0',
                      binDir = '/usr/bin',
                      gpiomonPath = null,
                      gpiosetPath = null,
                      gpioinfoPath = null,
                      pkillPath = null,
                      consumerTag = null,
                      reclaimOnBusy = false,
                    } = {}) {
    if (!GpioBackend.#defaultInstance) {
      GpioBackend.#defaultInstance = new GpioBackend({
        logger,
        clock,
        chip,
        binDir,
        gpiomonPath,
        gpiosetPath,
        gpioinfoPath,
        pkillPath,
        consumerTag,
        reclaimOnBusy,
      })
    }
    return GpioBackend.#defaultInstance
  }

  #logger
  #clock
  #chip

  #gpiomonPath
  #gpiosetPath
  #gpioinfoPath
  #pkillPath

  #consumerTag
  #reclaimOnBusy

  #lines
  #disposed

  /**
   * Create a backend instance (usually you want {@link GpioBackend.getDefault}).
   *
   * Inputs:
   * - tool paths and behavior flags
   *
   * Output:
   * - a backend instance that can create/share per-line state objects
   *
   * @example
   * import GpioBackend from './gpioBackend.js'
   *
   * const backend = new GpioBackend({
   *   chip: 'gpiochip0',
   *   binDir: '/usr/bin',
   *   consumerTag: 'charlie'
   * })
   *
   * @param {GpioBackendOptions} [opts]
   */
  constructor({
                logger,
                clock,
                chip = 'gpiochip0',
                binDir = '/usr/bin',
                gpiomonPath = null,
                gpiosetPath = null,
                gpioinfoPath = null,
                pkillPath = null,
                consumerTag = null,
                reclaimOnBusy = false,
              } = {}) {
    this.#logger = logger
    this.#clock = clock
    this.#chip = String(chip || 'gpiochip0')

    const dir = String(binDir || '/usr/bin')
    this.#gpiomonPath = String(gpiomonPath || path.join(dir, 'gpiomon'))
    this.#gpiosetPath = String(gpiosetPath || path.join(dir, 'gpioset'))
    this.#gpioinfoPath = String(gpioinfoPath || path.join(dir, 'gpioinfo'))
    this.#pkillPath = String(pkillPath || path.join(dir, 'pkill'))

    this.#assertBinaryExists(this.#gpiomonPath, 'gpiomon')
    this.#assertBinaryExists(this.#gpiosetPath, 'gpioset')
    this.#assertBinaryExists(this.#gpioinfoPath, 'gpioinfo')

    const tag = String(consumerTag || '').trim()
    this.#consumerTag = tag ? tag : null
    this.#reclaimOnBusy = Boolean(reclaimOnBusy)

    if (this.#reclaimOnBusy && !this.#consumerTag) {
      throw new Error('GpioBackend: reclaimOnBusy requires consumerTag')
    }

    if (this.#reclaimOnBusy) {
      this.#assertBinaryExists(this.#pkillPath, 'pkill')
    }

    this.#lines = new Map()
    this.#disposed = false

    bindProcessExitOnce()
    activeBackends.add(this)
  }

  /**
   * Get the configured gpio chip name.
   *
   * @example
   * const backend = GpioBackend.getDefault()
   * console.log(backend.getChip())
   *
   * @returns {string}
   */
  getChip() {
    return this.#chip
  }

  /**
   * Get resolved binary paths used by this backend.
   *
   * @example
   * const backend = GpioBackend.getDefault()
   * console.log(backend.getBinaries())
   *
   * @returns {{gpiomonPath: string, gpiosetPath: string, gpioinfoPath: string, pkillPath: string}}
   */
  getBinaries() {
    return {
      gpiomonPath: this.#gpiomonPath,
      gpiosetPath: this.#gpiosetPath,
      gpioinfoPath: this.#gpioinfoPath,
      pkillPath: this.#pkillPath,
    }
  }

  /**
   * Get consumer tag used to generate `--consumer` values.
   *
   * @example
   * const backend = GpioBackend.getDefault({ consumerTag: 'charlie' })
   * console.log(backend.getConsumerTag())
   *
   * @returns {string|null}
   */
  getConsumerTag() {
    return this.#consumerTag
  }

  /**
   * Whether busy-line reclaim is enabled.
   *
   * @example
   * const backend = GpioBackend.getDefault({ consumerTag: 'charlie', reclaimOnBusy: true })
   * console.log(backend.getReclaimOnBusy())
   *
   * @returns {boolean}
   */
  getReclaimOnBusy() {
    return this.#reclaimOnBusy
  }

  /**
   * Whether this backend has been disposed.
   *
   * @example
   * const backend = GpioBackend.getDefault()
   * console.log(backend.isDisposed())
   *
   * @returns {boolean}
   */
  isDisposed() {
    return this.#disposed
  }

  /**
   * Dispose this backend and all active line states created by it.
   *
   * Output:
   * - Returns void
   *
   * Side effects:
   * - Stops all gpiomon monitors and gpioset hogs started via this backend.
   *
   * @example
   * const backend = GpioBackend.getDefault()
   * backend.dispose()
   */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    for (const line of this.#lines.values()) {
      try {
        line.dispose()
      } catch {}
    }

    this.#lines.clear()
    activeBackends.delete(this)

    if (GpioBackend.#defaultInstance === this) {
      GpioBackend.#defaultInstance = null
    }
  }

  /**
   * Get a shared line state object for a numeric line offset.
   *
   * Inputs:
   * - `lineNumber`: numeric line offset (e.g. 17)
   *
   * Output:
   * - Returns a shared EventEmitter-like line state instance for this backend+line.
   *   - If called multiple times with the same line number, returns the same instance.
   *
   * Events emitted by the returned object:
   * - 'edge' and 'interrupt' payload: { level: 0|1|2, tick: number, raw: string }
   * - 'error' payload: { source: string, message: string }
   *
   * @example
   * const backend = GpioBackend.getDefault({ consumerTag: 'charlie' })
   * const line = backend.getLine(4)
   * line.on('interrupt', (e) => console.log(e.level, e.tick))
   *
   * @param {number} lineNumber
   * @returns {EventEmitter}
   */
  getLine(lineNumber) {
    if (this.#disposed) {
      throw new Error('GpioBackend is disposed')
    }

    const line = Number(lineNumber)
    if (Number.isNaN(line)) {
      throw new Error('GpioBackend.getLine requires numeric lineNumber')
    }

    const key = String(line)
    const existing = this.#lines.get(key)
    if (existing) return existing

    const state = new GpioLineState({
      logger: this.#logger,
      clock: this.#clock,
      chip: this.#chip,
      line,
      gpiomonPath: this.#gpiomonPath,
      gpiosetPath: this.#gpiosetPath,
      gpioinfoPath: this.#gpioinfoPath,
      pkillPath: this.#pkillPath,
      consumerTag: this.#consumerTag,
      reclaimOnBusy: this.#reclaimOnBusy,
      onEmptyListeners: () => {
        if (this.#disposed) return
        this.#maybePruneLine(key)
      }
    })

    this.#lines.set(key, state)
    return state
  }

  #maybePruneLine(key) {
    const st = this.#lines.get(key)
    if (!st) return

    if (st.isIdle()) {
      st.dispose()
      this.#lines.delete(key)
    }
  }

  #assertBinaryExists(p, name) {
    try {
      fs.accessSync(p, fs.constants.X_OK)
    } catch {
      throw new Error(`GpioBackend: ${name} binary not found or not executable at "${p}"`)
    }
  }
}

/**
 * Internal per-line state object.
 *
 * It emits:
 * - 'edge' and 'interrupt' events with payload { level, tick, raw }
 * - 'error' events with payload { source, message }
 *
 * Public surface used by {@link Gpio}:
 * - configure({ mode, pull, edge })
 * - digitalWrite(level)
 * - (digitalRead is not implemented)
 */
class GpioLineState extends EventEmitter {
  #logger
  #clock
  #chip
  #line

  #gpiomonPath
  #gpiosetPath
  #gpioinfoPath
  #pkillPath

  #consumerTag
  #reclaimOnBusy

  #disposed

  #mode
  #pull
  #edge

  #monitor
  #hogProc
  #hogLevel
  #hogStopExpected

  #stdoutBuf
  #stderrMon
  #stderrHog

  #listenerCount
  #onEmptyListeners

  constructor({
                logger,
                clock,
                chip,
                line,
                gpiomonPath,
                gpiosetPath,
                gpioinfoPath,
                pkillPath,
                consumerTag,
                reclaimOnBusy,
                onEmptyListeners
              }) {
    super()

    this.#logger = logger
    this.#clock = clock
    this.#chip = String(chip || 'gpiochip0')
    this.#line = Number(line)

    this.#gpiomonPath = String(gpiomonPath)
    this.#gpiosetPath = String(gpiosetPath)
    this.#gpioinfoPath = String(gpioinfoPath)
    this.#pkillPath = String(pkillPath)

    this.#consumerTag = consumerTag ? String(consumerTag).trim() : null
    this.#reclaimOnBusy = Boolean(reclaimOnBusy)

    this.#disposed = false

    this.#mode = null
    this.#pull = 'as-is'
    this.#edge = 'either'

    this.#monitor = null
    this.#hogProc = null
    this.#hogLevel = null
    this.#hogStopExpected = false

    this.#stdoutBuf = ''
    this.#stderrMon = ''
    this.#stderrHog = ''

    this.#listenerCount = 0
    this.#onEmptyListeners = typeof onEmptyListeners === 'function' ? onEmptyListeners : null
  }

  /**
   * Whether this line state currently has no listeners and no active processes.
   *
   * @example
   * const st = backend.getLine(17)
   * console.log(st.isIdle())
   *
   * @returns {boolean}
   */
  isIdle() {
    return this.#listenerCount === 0 && !this.#monitor && !this.#hogProc
  }

  /**
   * Dispose this line state. Stops monitor/hog and clears listeners.
   *
   * @example
   * const st = backend.getLine(17)
   * st.dispose()
   */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    this.#stopMonitor()
    this.#stopHog()

    this.removeAllListeners()
  }

  /**
   * Apply configuration values for this line state.
   *
   * Inputs:
   * - `mode`: stored for future expansion (currently not enforced by libgpiod calls in this implementation)
   * - `pull`: used as `gpiomon --bias <pull>` when monitor starts
   * - `edge`: used as JS-side filter for emitting events
   *
   * Output:
   * - returns void
   *
   * @example
   * st.configure({ pull: 'pull-down', edge: 'rising' })
   *
   * @param {{mode?: any, pull?: any, edge?: any}} [cfg]
   */
  configure({ mode = null, pull = null, edge = null } = {}) {
    if (this.#disposed) return

    if (mode !== null && mode !== undefined) this.#mode = mode
    if (pull !== null && pull !== undefined) this.#pull = pull
    if (edge !== null && edge !== undefined) this.#edge = edge

    if (this.#listenerCount > 0) {
      this.#restartMonitor()
    }
  }

  /**
   * Read input level (not implemented).
   *
   * @example
   * try { st.digitalRead() } catch (e) { console.error(e.message) }
   *
   * @throws {Error}
   * @returns {0|1}
   */
  digitalRead() {
    throw new Error('digitalRead is not implemented yet (use interrupts for now)')
  }

  /**
   * Write output level.
   *
   * Input:
   * - `level`: must be 0 or 1.
   *
   * Output:
   * - returns `this` for chaining.
   *
   * @example
   * st.digitalWrite(1).digitalWrite(0)
   *
   * @param {0|1|number} level
   * @returns {this}
   */
  digitalWrite(level) {
    if (this.#disposed) return this

    const v = Number(level)
    if (v !== 0 && v !== 1) {
      throw new Error('digitalWrite(level) requires level 0 or 1')
    }

    this.#ensureHogLevel(v, { allowReclaim: true })
    return this
  }

  on(eventName, listener) {
    super.on(eventName, listener)

    if (eventName === 'interrupt' || eventName === 'edge') {
      this.#listenerCount += 1
      if (this.#listenerCount === 1) {
        this.#ensureMonitor()
      }
    }

    return this
  }

  off(eventName, listener) {
    super.off(eventName, listener)

    if (eventName === 'interrupt' || eventName === 'edge') {
      this.#listenerCount = Math.max(0, this.#listenerCount - 1)
      if (this.#listenerCount === 0) {
        this.#stopMonitor()
        if (this.#onEmptyListeners) this.#onEmptyListeners()
      }
    }

    return this
  }

  removeListener(eventName, listener) {
    return this.off(eventName, listener)
  }

  removeAllListeners(eventName) {
    if (eventName === 'interrupt' || eventName === 'edge') {
      const count = this.listenerCount(eventName)
      super.removeAllListeners(eventName)

      this.#listenerCount = Math.max(0, this.#listenerCount - count)
      if (this.#listenerCount === 0) {
        this.#stopMonitor()
        if (this.#onEmptyListeners) this.#onEmptyListeners()
      }

      return this
    }

    return super.removeAllListeners(eventName)
  }

  #makeConsumer(kind) {
    if (!this.#consumerTag) return null
    return `${this.#consumerTag}:${kind}:${this.#line}`
  }

  #restartMonitor() {
    this.#stopMonitor()
    this.#ensureMonitor()
  }

  #ensureMonitor() {
    if (this.#monitor || this.#disposed) return

    const args = [
      '-c',
      this.#chip,
      '--num-events=0',
    ]

    const consumer = this.#makeConsumer('mon')
    if (consumer) {
      args.push('-C', consumer)
    }

    const bias = this.#pull || 'as-is'
    if (bias !== 'as-is') {
      args.push('--bias', bias)
    }

    args.push(String(this.#line))

    const p = spawn(this.#gpiomonPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })

    this.#monitor = p
    this.#stdoutBuf = ''
    this.#stderrMon = ''

    p.stdout.on('data', (d) => {
      this.#stdoutBuf += d.toString('utf8')

      const lines = this.#stdoutBuf.split(/\r?\n/)
      this.#stdoutBuf = lines.pop() || ''

      for (const raw of lines) {
        const s = raw.trim()
        if (!s) continue

        const level = this.#parseLevelFromGpiomonLine(s)
        if (!this.#shouldEmitForEdge(level)) continue

        const tick = this.#getTick32()

        this.emit('edge', { level, tick, raw: s })
        this.emit('interrupt', { level, tick, raw: s })
      }
    })

    p.stderr.on('data', (d) => {
      this.#stderrMon += d.toString('utf8')
      if (this.#stderrMon.length > 32_768) {
        this.#stderrMon = this.#stderrMon.slice(-16_384)
      }
    })

    p.on('error', (err) => {
      this.#monitor = null
      this.emit('error', { source: 'gpiomon', message: `gpiomon failed: ${err?.message || err}` })
    })

    p.on('exit', (code, signal) => {
      this.#monitor = null

      const msg = this.#stderrMon.trim()
        ? this.#stderrMon.trim()
        : `gpiomon exited (code=${code}, signal=${signal})`

      this.emit('error', { source: 'gpiomon', message: msg })
    })
  }

  #stopMonitor() {
    if (!this.#monitor) return
    this.#killProcessGroup(this.#monitor)
    this.#monitor = null
  }

  #ensureHogLevel(level, { allowReclaim }) {
    if (level === 0) {
      this.#stopHog()
      return
    }

    if (this.#hogProc && this.#hogLevel === 1) {
      return
    }

    this.#stopHog()
    this.#startHogHigh({ allowReclaim })
  }

  #startHogHigh({ allowReclaim }) {
    const attemptSpawn = (attempt) => {
      const args = [
        '-c',
        this.#chip,
      ]

      const consumer = this.#makeConsumer('hog')
      if (consumer) {
        args.push('-C', consumer)
      }

      args.push(`${this.#line}=1`)

      const p = spawn(this.#gpiosetPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true
      })

      this.#hogProc = p
      this.#hogLevel = 1
      this.#stderrHog = ''
      this.#hogStopExpected = false

      p.stderr.on('data', (d) => {
        this.#stderrHog += d.toString('utf8')
        if (this.#stderrHog.length > 32_768) {
          this.#stderrHog = this.#stderrHog.slice(-16_384)
        }
      })

      p.on('error', (err) => {
        this.#hogProc = null
        this.#hogLevel = null
        this.#hogStopExpected = false
        this.emit('error', { source: 'gpioset', message: `gpioset failed: ${err?.message || err}` })
      })

      p.on('exit', (code, signal) => {
        const expected = this.#hogStopExpected

        const msg = this.#stderrHog.trim()
          ? this.#stderrHog.trim()
          : `gpioset exited (code=${code}, signal=${signal})`

        this.#hogProc = null
        this.#hogLevel = null
        this.#hogStopExpected = false

        if (this.#disposed) {
          return
        }

        if (expected && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
          return
        }

        const lower = msg.toLowerCase()
        const isBusy = lower.includes('device or resource busy') || lower.includes('resource busy') || lower.includes('busy')

        if (isBusy && allowReclaim && this.#reclaimOnBusy && attempt === 0) {
          const info = this.#getLineInfo()
          const consumerSeen = this.#extractConsumer(info)

          const ours = Boolean(
            this.#consumerTag &&
            consumerSeen &&
            (consumerSeen === this.#consumerTag || consumerSeen.startsWith(`${this.#consumerTag}:`))
          )

          if (ours) {
            this.#tryReclaimByPkillPattern(`${this.#consumerTag}:hog:${this.#line}`)
            this.#tryReclaimByPkillPattern(`${this.#consumerTag}:mon:${this.#line}`)

            setTimeout(() => {
              attemptSpawn(1)
            }, 150)

            return
          }

          const enriched = consumerSeen
            ? `busy (consumer="${consumerSeen}", tag="${this.#consumerTag}")`
            : `busy`

          this.emit('error', { source: 'gpioset', message: `${enriched}; gpioinfo: ${info || 'n/a'}` })
          return
        }

        this.emit('error', { source: 'gpioset', message: msg })
      })
    }

    attemptSpawn(0)
  }

  #stopHog() {
    if (!this.#hogProc) {
      this.#hogLevel = null
      this.#hogStopExpected = false
      return
    }

    this.#hogStopExpected = true

    this.#killProcessGroup(this.#hogProc)
    this.#hogProc = null
    this.#hogLevel = null
  }

  #tryReclaimByPkillPattern(pattern) {
    try {
      spawnSync(this.#pkillPath, ['-f', pattern], { stdio: 'ignore' })
    } catch (e) {
      if (this.#logger?.error) {
        this.#logger.error('gpio_reclaim_pkill_failed', { pattern, error: String(e?.message || e) })
      }
    }
  }

  #getLineInfo() {
    try {
      const res = spawnSync(this.#gpioinfoPath, ['-c', this.#chip, String(this.#line)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const out = String(res.stdout || '').trim()
      const err = String(res.stderr || '').trim()

      if (out) return out
      if (err) return err

      return null
    } catch {
      return null
    }
  }

  #extractConsumer(gpioinfoLine) {
    const s = String(gpioinfoLine || '')
    const m = s.match(/consumer="([^"]+)"/)
    return m ? m[1] : null
  }

  #killProcessGroup(p) {
    if (!p || !p.pid) return
    const pid = p.pid

    try { process.kill(-pid, 'SIGTERM') } catch {}
    try { process.kill(-pid, 'SIGKILL') } catch {}
  }

  #getTick32() {
    if (this.#clock?.nowMs) {
      return (this.#clock.nowMs() >>> 0)
    }
    return (Date.now() >>> 0)
  }

  #parseLevelFromGpiomonLine(raw) {
    const s = String(raw || '').toLowerCase()

    if (s.includes('rising')) return 1
    if (s.includes('falling')) return 0

    return 2
  }

  #shouldEmitForEdge(level) {
    const edge = this.#edge || 'either'

    if (level === 2) return true
    if (edge === 'either') return true
    if (edge === 'rising') return level === 1
    if (edge === 'falling') return level === 0

    return true
  }
}

export default GpioBackend
