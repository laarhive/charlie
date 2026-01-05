// src/app/cliParser.js
export class CliParser {
  /**
   * Parses a single input line into a command object.
   *
   * @param {string} line
   *
   * @example
   * const parser = new CliParser()
   * const cmd = parser.parse('front on')
   */
  parse(line) {
    const trimmed = String(line || '').trim()
    if (!trimmed) {
      return { kind: 'empty' }
    }

    const parts = trimmed.split(/\s+/g)
    const [a, b, ...rest] = parts

    if (a === 'help') {
      return { kind: 'help' }
    }

    if (a === 'exit' || a === 'quit') {
      return { kind: 'exit' }
    }

    if (a === 'state') {
      return { kind: 'state' }
    }

    if (a === 'front' || a === 'back') {
      if (b === 'on') {
        return { kind: 'presence', zone: a, on: true }
      }

      if (b === 'off') {
        return { kind: 'presence', zone: a, on: false }
      }

      return { kind: 'error', message: 'usage: front on|off or back on|off' }
    }

    if (a === 'time') {
      if (b === 'now') {
        return { kind: 'timeNow' }
      }

      if (b && b.startsWith('+')) {
        const ms = Number(b.slice(1))
        if (Number.isNaN(ms) || ms < 0) {
          return { kind: 'error', message: 'usage: time +MS (MS must be >= 0)' }
        }

        return { kind: 'timeAdvance', ms }
      }

      if (b === 'set') {
        const dateStr = rest[0]
        const timeStr = rest[1]

        if (!dateStr || !timeStr) {
          return { kind: 'error', message: 'usage: time set YYYY-MM-DD HH:MM' }
        }

        return { kind: 'timeSet', dateStr, timeStr }
      }

      return { kind: 'error', message: 'usage: time now | time +MS | time set YYYY-MM-DD HH:MM' }
    }

    if (a === 'config' && b === 'load') {
      const filename = rest[0]
      if (!filename) {
        return { kind: 'error', message: 'usage: config load <filename>' }
      }

      return { kind: 'configLoad', filename }
    }

    return { kind: 'error', message: 'unknown command, type: help' }
  }
}

export default CliParser
