// src/sim/cliSimController.js
import readline from 'node:readline'
import eventTypes from '../core/eventTypes.js'

export class CliSimController {
  #logger
  #parser
  #loadConfig
  #getContext
  #setContext
  #rl

  constructor({ logger, parser, loadConfig, getContext, setContext }) {
    this.#logger = logger
    this.#parser = parser
    this.#loadConfig = loadConfig
    this.#getContext = getContext
    this.#setContext = setContext
    this.#rl = null
  }

  /**
   * Starts the CLI prompt for sim mode.
   *
   * @example
   * cli.start()
   */
  start() {
    if (this.#rl) {
      return
    }

    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    this.#rl.on('line', (line) => {
      const cmd = this.#parser.parse(line)
      this.#handleCommand(cmd)
      this.#updatePrompt()
      this.#rl.prompt()
    })

    this.#rl.on('close', () => {
      this.#logger.notice('cli_closed', {})
      process.exit(0)
    })

    this.#printHelp()
    this.#updatePrompt()
    this.#rl.prompt()
  }

  /**
   * Stops the CLI prompt.
   *
   * @example
   * cli.dispose()
   */
  dispose() {
    if (!this.#rl) {
      return
    }

    this.#rl.close()
    this.#rl = null
  }

  #handleCommand(cmd) {
    if (cmd.kind === 'empty') {
      return
    }

    if (cmd.kind === 'help') {
      this.#printHelp()
      return
    }

    if (cmd.kind === 'error') {
      console.log(cmd.message)
      return
    }

    if (cmd.kind === 'exit') {
      process.exit(0)
    }

    if (cmd.kind === 'coreState') {
      const { core } = this.#getContext()
      this.#logger.info('snapshot', core.getSnapshot())
      return
    }

    if (cmd.kind === 'sensorPresence') {
      this.#publishPresence(cmd.zone, cmd.on)
      return
    }

    if (cmd.kind === 'clockNow') {
      const { clock, core } = this.#getContext()
      const parts = clock.toLocalParts()
      const snap = core.getSnapshot()

      this.#logger.info('clock_now', {
        ...parts,
        isFrozen: clock.isFrozen(),
        nowMs: clock.nowMs(),
        state: snap.state,
      })

      return
    }

    if (cmd.kind === 'clockStatus') {
      const { clock } = this.#getContext()
      const parts = clock.toLocalParts()

      this.#logger.info('clock_status', {
        ...parts,
        isFrozen: clock.isFrozen(),
        nowMs: clock.nowMs(),
      })

      return
    }

    if (cmd.kind === 'clockFreeze') {
      const { clock } = this.#getContext()
      clock.freeze()
      this.#logger.notice('clock_frozen', { nowMs: clock.nowMs() })
      return
    }

    if (cmd.kind === 'clockResume') {
      const { clock } = this.#getContext()
      clock.resume()
      this.#logger.notice('clock_resumed', { nowMs: clock.nowMs() })
      return
    }

    if (cmd.kind === 'clockAdvance') {
      const { clock } = this.#getContext()
      clock.advance(cmd.ms)
      this.#logger.info('clock_advanced', { deltaMs: cmd.ms, nowMs: clock.nowMs(), isFrozen: clock.isFrozen() })
      return
    }

    if (cmd.kind === 'clockSet') {
      const dt = this.#parseDateTime(cmd.dateStr, cmd.timeStr)
      if (!dt) {
        console.log('invalid datetime, usage: clock set YYYY-MM-DD HH:MM')
        return
      }

      const { clock } = this.#getContext()
      clock.setLocalDateTime(dt)
      this.#logger.notice('clock_set', { ...dt, nowMs: clock.nowMs(), isFrozen: clock.isFrozen() })
      return
    }

    if (cmd.kind === 'configLoad') {
      this.#reloadConfig(cmd.filename)
      return
    }

    if (cmd.kind === 'configPrint') {
      this.#printConfigInfo()
      return
    }

    if (cmd.kind === 'tapOn') {
      const { tap } = this.#getContext()
      tap.setEnabled(true)
      return
    }

    if (cmd.kind === 'tapOff') {
      const { tap } = this.#getContext()
      tap.setEnabled(false)
      return
    }

    if (cmd.kind === 'tapStatus') {
      const { tap } = this.#getContext()
      this.#logger.info('tap_status', { enabled: tap.isEnabled() })
      return
    }

    console.log('unknown command, type: help')
  }

  #publishPresence(zone, on) {
    if (zone !== 'front' && zone !== 'back') {
      this.#logger.warning('invalid_zone', { zone })
      return
    }

    const { clock, bus } = this.#getContext()

    const event = {
      type: on ? eventTypes.presence.enter : eventTypes.presence.exit,
      ts: clock.nowMs(),
      source: 'cliSim',
      payload: { zone },
    }

    this.#logger.debug('event_publish', event)
    bus.publish(event)
  }

  #reloadConfig(filename) {
    try {
      const { config, fullPath } = this.#loadConfig(filename)
      this.#setContext({ config })
      this.#logger.notice('config_loaded', { configFile: fullPath })
    } catch (e) {
      this.#logger.error('config_load_failed', { configFile: filename, error: String(e?.message || e) })
    }
  }

  #printConfigInfo() {
    const { config } = this.#getContext()
    this.#logger.info('config_print', config)
  }

  #parseDateTime(dateStr, timeStr) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
    const tm = /^(\d{2}):(\d{2})$/.exec(timeStr)

    if (!dm || !tm) {
      return null
    }

    const year = Number(dm[1])
    const month = Number(dm[2])
    const day = Number(dm[3])
    const hour = Number(tm[1])
    const minute = Number(tm[2])

    if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) {
      return null
    }

    return { year, month, day, hour, minute }
  }

  #updatePrompt() {
    const { clock } = this.#getContext()
    const glyph = clock.isFrozen() ? '❄' : '▶'
    this.#rl.setPrompt(`charlie(sim${glyph})> `)
  }

  #printHelp() {
    console.log('')
    console.log('Commands:')
    console.log('')
    console.log('  sensor front on|off')
    console.log('  sensor back on|off')
    console.log('')
    console.log('  clock now')
    console.log('  clock status')
    console.log('  clock freeze')
    console.log('  clock resume')
    console.log('  clock +MS')
    console.log('  clock set YYYY-MM-DD HH:MM')
    console.log('')
    console.log('  core state')
    console.log('  config load <filename>')
    console.log('  config print')
    console.log('')
    console.log('  tap on')
    console.log('  tap off')
    console.log('  tap status')
    console.log('')
    console.log('  help')
    console.log('  exit')
    console.log('')
  }
}

export default CliSimController
