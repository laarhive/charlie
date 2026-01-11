// src/app/cliParser.js

/**
 * CLI parser.
 *
 * Converts user input lines into command objects consumed by CliSimController.
 *
 * @example
 * const parser = new CliParser()
 * parser.parse('inject on')
 */
export class CliParser {
  /**
   * Parses a single input line into a command object.
   *
   * @param {string} line
   * @returns {object}
   *
   * @example
   * const cmd = parser.parse('presence front on')
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

    if (a === 'inject') {
      if (b === 'on') {
        return { kind: 'injectOn' }
      }

      if (b === 'off') {
        return { kind: 'injectOff' }
      }

      if (b === 'status') {
        return { kind: 'injectStatus' }
      }

      return { kind: 'error', message: 'usage: inject on|off|status' }
    }

    if (a === 'tap') {
      const bus = b
      const action = c

      const validBus =
        bus === 'main' ||
        bus === 'presence' ||
        bus === 'vibration' ||
        bus === 'button' ||
        bus === 'tasker' ||
        bus === 'all'

      if (!validBus) {
        return { kind: 'error', message: 'usage: tap main|presence|vibration|button|tasker|all on|off|status' }
      }

      if (action === 'on') {
        return { kind: 'tapOn', bus }
      }

      if (action === 'off') {
        return { kind: 'tapOff', bus }
      }

      if (action === 'status') {
        return { kind: 'tapStatus', bus }
      }

      return { kind: 'error', message: 'usage: tap main|presence|vibration|button|tasker|all on|off|status' }
    }

    if (a === 'presence') {
      const zone = b
      const action = c

      if (zone !== 'front' && zone !== 'back') {
        return { kind: 'error', message: 'usage: presence front|back on|off' }
      }

      if (action === 'on') {
        return { kind: 'presence', zone, present: true }
      }

      if (action === 'off') {
        return { kind: 'presence', zone, present: false }
      }

      return { kind: 'error', message: 'usage: presence front|back on|off' }
    }

    if (a === 'vibration') {
      const level = b

      if (level !== 'low' && level !== 'high') {
        return { kind: 'error', message: 'usage: vibration low|high' }
      }

      return { kind: 'vibration', level }
    }

    if (a === 'button') {
      const pressType = b

      if (pressType !== 'short' && pressType !== 'long') {
        return { kind: 'error', message: 'usage: button short|long' }
      }

      return { kind: 'button', pressType }
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

      return { kind: 'error', message: 'usage: clock now|status|freeze|resume|+MS|set YYYY-MM-DD HH:MM' }
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

      return { kind: 'error', message: 'usage: config load <filename>|print' }
    }

    if (a === 'core') {
      if (b === 'state') {
        return { kind: 'coreState' }
      }

      return { kind: 'error', message: 'usage: core state' }
    }

    if (a === 'virt') {
      if (b === 'list') {
        return { kind: 'virtList' }
      }

      if (b === 'set') {
        const sensorId = c
        const action = rest[0]

        if (!sensorId) {
          return { kind: 'error', message: 'usage: virt set <sensorId> on|off' }
        }

        if (action !== 'on' && action !== 'off') {
          return { kind: 'error', message: 'usage: virt set <sensorId> on|off' }
        }

        return { kind: 'virtSet', sensorId, value: action === 'on' }
      }

      return { kind: 'error', message: 'usage: virt list|set <sensorId> on|off' }
    }

    return { kind: 'error', message: 'unknown command, type: help' }
  }
}

export default CliParser
