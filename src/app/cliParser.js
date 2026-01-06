// src/app/cliParser.js
export class CliParser {
  /**
   * Parses a single input line into a command object.
   *
   * @param {string} line
   *
   * @example
   * const parser = new CliParser()
   * const cmd = parser.parse('sensor front on')
   */
  parse(line) {
    const trimmed = String(line || '').trim()
    if (!trimmed) {
      return { kind: 'empty' }
    }

    const parts = trimmed.split(/\s+/g)
    const [a, b, c, ...rest] = parts

    if (a === 'help') {
      return { kind: 'help' }
    }

    if (a === 'exit' || a === 'quit') {
      return { kind: 'exit' }
    }

    if (a === 'sensor') {
      if (b !== 'front' && b !== 'back') {
        return { kind: 'error', message: 'usage: sensor front|back on|off' }
      }

      if (c === 'on') {
        return { kind: 'sensorPresence', zone: b, on: true }
      }

      if (c === 'off') {
        return { kind: 'sensorPresence', zone: b, on: false }
      }

      return { kind: 'error', message: 'usage: sensor front|back on|off' }
    }

    if (a === 'clock') {
      if (b === 'now') {
        return { kind: 'clockNow' }
      }

      if (b === 'status') {
        return { kind: 'clockStatus' }
      }

      if (b === 'freeze') {
        return { kind: 'clockFreeze' }
      }

      if (b === 'resume') {
        return { kind: 'clockResume' }
      }

      if (b && b.startsWith('+')) {
        const ms = Number(b.slice(1))
        if (Number.isNaN(ms) || ms < 0) {
          return { kind: 'error', message: 'usage: clock +MS (MS must be >= 0)' }
        }

        return { kind: 'clockAdvance', ms }
      }

      if (b === 'set') {
        const dateStr = c
        const timeStr = rest[0]

        if (!dateStr || !timeStr) {
          return { kind: 'error', message: 'usage: clock set YYYY-MM-DD HH:MM' }
        }

        return { kind: 'clockSet', dateStr, timeStr }
      }

      return { kind: 'error', message: 'usage: clock now|status|freeze|resume | clock +MS | clock set YYYY-MM-DD HH:MM' }
    }

    if (a === 'config') {
      if (b === 'load') {
        const filename = c
        if (!filename) {
          return { kind: 'error', message: 'usage: config load <filename>' }
        }

        return { kind: 'configLoad', filename }
      }

      if (b === 'print') {
        return { kind: 'configPrint' }
      }

      return { kind: 'error', message: 'usage: config load <filename> | config print' }
    }

    if (a === 'core') {
      if (b === 'state') {
        return { kind: 'coreState' }
      }

      return { kind: 'error', message: 'usage: core state' }
    }

    return { kind: 'error', message: 'unknown command, type: help' }
  }
}

export default CliParser
