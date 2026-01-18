// src/hw/signal/gpioBinarySignalGpiod.js
import { spawn } from 'node:child_process'

/**
 * GPIO-backed binary signal using libgpiod (gpiomon).
 *
 * Contract:
 * - subscribe(handler) -> unsubscribe
 *
 * Notes:
 * - Edge-based only (no synchronous read)
 * - Requires libgpiod v2 userspace tools
 * - Uses absolute path to avoid PATH issues
 *
 * @example
 * const sig = new GpioBinarySignalGpiod({
 *   chip: 'gpiochip0',
 *   line: 17,
 *   activeHigh: true
 * })
 */
export class GpioBinarySignalGpiod {
  #chip
  #line
  #activeHigh
  #handlers
  #monitor
  #disposed

  constructor({ chip, line, activeHigh = true }) {
    if (!chip) {
      throw new Error('GpioBinarySignalGpiod requires hw.chip (e.g. gpiochip0)')
    }

    const n = Number(line)
    if (Number.isNaN(n)) {
      throw new Error('GpioBinarySignalGpiod requires hw.line (number)')
    }

    this.#chip = chip
    this.#line = n
    this.#activeHigh = Boolean(activeHigh)
    this.#handlers = new Set()
    this.#monitor = null
    this.#disposed = false
  }

  read() {
    throw new Error(
      'GpioBinarySignalGpiod.read() not supported. Use edge events via subscribe().'
    )
  }

  subscribe(handler) {
    if (this.#disposed) {
      return () => {}
    }

    this.#handlers.add(handler)

    if (this.#handlers.size === 1) {
      this.#startMonitor()
    }

    return () => {
      this.#handlers.delete(handler)

      if (this.#handlers.size === 0) {
        this.#stopMonitor()
      }
    }
  }

  dispose() {
    this.#disposed = true
    this.#handlers.clear()
    this.#stopMonitor()
  }

  #toLogical(raw) {
    const v = Boolean(raw)
    return this.#activeHigh ? v : !v
  }

  #startMonitor() {
    if (this.#monitor || this.#disposed) {
      return
    }

    const args = [
      '-c',
      this.#chip,
      '--num-events=0',
      '--silent',
      String(this.#line),
    ]

    this.#monitor = spawn('/usr/bin/gpiomon', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let buf = ''

    this.#monitor.stdout.on('data', (d) => {
      buf += d.toString('utf8')

      const lines = buf.split(/\r?\n/)
      buf = lines.pop() || ''

      for (const line of lines) {
        const raw = this.#parseGpiomonLine(line)
        if (raw === null) {
          continue
        }

        const logical = this.#toLogical(raw)
        for (const h of this.#handlers) {
          h(logical)
        }
      }
    })

    this.#monitor.stderr.on('data', (d) => {
      // gpiomon is usually silent; stderr indicates real issues
      // Keep process alive but surface the problem
      console.error('[gpiomon]', d.toString('utf8').trim())
    })

    this.#monitor.on('error', (err) => {
      this.#monitor = null

      throw new Error(
        `Failed to start gpiomon at /usr/bin/gpiomon.\n` +
        `Is libgpiod installed and accessible?\n` +
        err.message
      )
    })

    this.#monitor.on('exit', () => {
      this.#monitor = null
    })
  }

  #stopMonitor() {
    if (!this.#monitor) {
      return
    }

    this.#monitor.kill()
    this.#monitor = null
  }

  #parseGpiomonLine(line) {
    const s = String(line || '').trim()
    if (!s) {
      return null
    }

    // libgpiod v2 textual output
    if (s.includes('RISING') || s.includes('rising')) {
      return true
    }

    if (s.includes('FALLING') || s.includes('falling')) {
      return false
    }

    // Fallback: trailing numeric value
    const m = /(\d+)\s*$/.exec(s)
    if (!m) {
      return null
    }

    const n = Number(m[1])
    if (Number.isNaN(n)) {
      return null
    }

    return n !== 0
  }
}

export default GpioBinarySignalGpiod
