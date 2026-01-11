import { spawn } from 'node:child_process'

/**
 * GPIO-backed binary signal using libgpiod tools (gpiomon).
 *
 * Contract:
 * - subscribe(handler) -> unsubscribe
 *
 * Note: read() is intentionally not implemented synchronously.
 *
 * @example
 * const sig = new GpioBinarySignalGpiod({ chip: 'gpiochip0', line: 17, activeHigh: true })
 * const unsub = sig.subscribe((v) => console.log(v))
 */
export class GpioBinarySignalGpiod {
  #chip
  #line
  #activeHigh
  #handlers
  #monitor
  #disposed

  constructor({ chip, line, activeHigh = true }) {
    this.#chip = chip
    this.#line = Number(line)
    this.#activeHigh = Boolean(activeHigh)
    this.#handlers = new Set()
    this.#monitor = null
    this.#disposed = false

    if (!this.#chip) {
      throw new Error('GpioBinarySignalGpiod requires hw.chip (e.g. gpiochip0)')
    }

    if (Number.isNaN(this.#line)) {
      throw new Error('GpioBinarySignalGpiod requires hw.line (number)')
    }
  }

  read() {
    throw new Error('GpioBinarySignalGpiod.read() not supported synchronously. Use edge events.')
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
    if (this.#monitor) {
      return
    }

    const args = [
      '--num-events=0',
      '--silent',
      this.#chip,
      `${this.#line}`,
    ]

    this.#monitor = spawn('gpiomon', args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let buf = ''

    this.#monitor.stdout.on('data', (d) => {
      buf += d.toString('utf8')

      const lines = buf.split(/\r?\n/g)
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

    if (s.includes('RISING') || s.includes('rising')) {
      return true
    }

    if (s.includes('FALLING') || s.includes('falling')) {
      return false
    }

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
