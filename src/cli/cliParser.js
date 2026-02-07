// src/cli/cliParser.js
import { parseRecording } from './recording/cliRecording.js'

export class CliParser {
  parse(line) {
    const trimmed = String(line || '').trim()
    if (!trimmed) return { kind: 'empty' }

    const parts = trimmed.split(/\s+/g)
    const [a, b, c, ...rest] = parts

    if (a === 'help') return { kind: 'help' }
    if (a === 'exit' || a === 'quit') return { kind: 'exit' }

    if (a === 'inject') {
      if (b === 'on') return { kind: 'injectOn' }
      if (b === 'off') return { kind: 'injectOff' }
      if (b === 'status') return { kind: 'injectStatus' }
      return { kind: 'error', message: 'usage: inject on|off|status' }
    }

    if (a === 'presence') {
      const zone = b
      const action = c

      if (zone !== 'front' && zone !== 'back') {
        return { kind: 'error', message: 'usage: presence front|back on|off' }
      }

      if (action === 'on') return { kind: 'presence', zone, present: true }
      if (action === 'off') return { kind: 'presence', zone, present: false }

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
      if (b === 'now') return { kind: 'clockNow' }
      if (b === 'status') return { kind: 'clockStatus' }
      if (b === 'freeze') return { kind: 'clockFreeze' }
      if (b === 'resume') return { kind: 'clockResume' }

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
        if (!filename) return { kind: 'error', message: 'usage: config load <filename>' }
        return { kind: 'configLoad', filename }
      }

      if (b === 'print') return { kind: 'configPrint' }

      return { kind: 'error', message: 'usage: config load <filename>|print' }
    }

    if (a === 'core') {
      if (b === 'state') return { kind: 'coreState' }
      return { kind: 'error', message: 'usage: core state' }
    }

    if (a === 'device') {
      if (b === 'list') return { kind: 'deviceList' }

      if (b === 'block') {
        const deviceId = c
        if (!deviceId) return { kind: 'error', message: 'usage: device block <deviceId>' }
        return { kind: 'deviceBlock', deviceId }
      }

      if (b === 'unblock') {
        const deviceId = c
        if (!deviceId) return { kind: 'error', message: 'usage: device unblock <deviceId>' }
        return { kind: 'deviceUnblock', deviceId }
      }

      if (b === 'inject') {
        const deviceId = c
        if (!deviceId) return { kind: 'error', message: 'usage: device inject <deviceId> <payload...>' }

        const payload = rest.join(' ').trim()
        if (!payload) return { kind: 'error', message: 'usage: device inject <deviceId> <payload...>' }

        return { kind: 'deviceInject', deviceId, payload }
      }

      return { kind: 'error', message: 'usage: device list|block|unblock|inject <deviceId> <payload...>' }
    }

    if (a === 'recording') {
      const rec = parseRecording(parts)
      return rec || { kind: 'error', message: 'usage: recording status|start|record|load|play' }
    }

    return { kind: 'error', message: 'unknown command, type: help' }
  }
}

export default CliParser
