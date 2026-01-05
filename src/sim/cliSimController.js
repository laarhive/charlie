// src/sim/cliSimController.js
import eventTypes from '../core/eventTypes.js'

const CliSimController = class CliSimController {
  #logger
  #parser
  #loadConfig
  #getContext
  #setContext
  #onStdinData

  constructor({ logger, parser, loadConfig, getContext, setContext }) {
    this.#logger = logger
    this.#parser = parser
    this.#loadConfig = loadConfig
    this.#getContext = getContext
    this.#setContext = setContext
    this.#onStdinData = null
  }

  /**
   * Starts the stdin CLI loop for sim mode.
   *
   * @example
   * const cli = new CliSimController({ logger, parser, loadConfig, getContext, setContext })
   * cli.start()
   */
  start() {
    if (this.#onStdinData) {
      return
    }

    this.#printHelp()

    process.stdin.setEncoding('utf8')

    this.#onStdinData = (chunk) => {
      const lines = String(chunk).split(/\r?\n/g)

      for (const line of lines) {
        const cmd = this.#parser.parse(line)
        this.#handleCommand(cmd)
      }
    }

    process.stdin.on('data', this.#onStdinData)
  }

  /**
   * Stops the stdin CLI loop.
   *
   * @example
   * cli.dispose()
   */
  dispose() {
    if (!this.#onStdinData) {
      return
    }

    process.stdin.off('data', this.#onStdinData)
    this.#onStdinData = null
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
      this.#logger.warn('command_error', { message: cmd.message })
      return
    }

    if (cmd.kind === 'exit') {
      this.#logger.info('app_exit', {})
      process.exit(0)
    }

    if (cmd.kind === 'state') {
      const { core } = this.#getContext()
      const snap = core.getSnapshot()
      this.#logger.info('snapshot', snap)
      return
    }

    if (cmd.kind === 'presence') {
      this.#publishPresence(cmd.zone, cmd.on)
      return
    }

    if (cmd.kind === 'timeNow') {
      const { clock, core } = this.#getContext()
      const parts = clock.toLocalParts()
      const snap = core.getSnapshot()
      this.#logger.info('time_now', { ...parts, nowMs: clock.nowMs(), state: snap.state })
      return
    }

    if (cmd.kind === 'timeAdvance') {
      const { clock } = this.#getContext()
      clock.advance(cmd.ms)
      this.#logger.info('time_advanced', { deltaMs: cmd.ms, nowMs: clock.nowMs() })
      return
    }

    if (cmd.kind === 'timeSet') {
      const dt = this.#parseDateTime(cmd.dateStr, cmd.timeStr)
      if (!dt) {
        this.#logger.warn('command_error', { message: 'invalid datetime, usage: time set YYYY-MM-DD HH:MM' })
        return
      }

      const { clock } = this.#getContext()
      clock.setLocalDateTime(dt)
      this.#logger.info('time_set', { ...dt, nowMs: clock.nowMs() })
      return
    }

    if (cmd.kind === 'configLoad') {
      this.#reloadConfig(cmd.filename)
      return
    }

    this.#logger.warn('command_error', { message: 'unknown command, type: help' })
  }

  #publishPresence(zone, on) {
    if (zone !== 'front' && zone !== 'back') {
      this.#logger.warn('invalid_zone', { zone })
      return
    }

    const { clock, bus } = this.#getContext()

    const event = {
      type: on ? eventTypes.presence.enter : eventTypes.presence.exit,
      ts: clock.nowMs(),
      source: 'cliSim',
      payload: { zone },
    }

    this.#logger.debug('sim_event_publish', event)
    bus.publish(event)
  }

  #reloadConfig(filename) {
    try {
      const { config, fullPath } = this.#loadConfig(filename)

      this.#setContext({ config })
      this.#logger.info('config_loaded', { configFile: fullPath })
    } catch (e) {
      this.#logger.error('config_load_failed', { configFile: filename, error: String(e?.message || e) })
    }
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

  #printHelp() {
    console.log('')
    console.log('Sim commands:')
    console.log('  front on|off')
    console.log('  back on|off')
    console.log('  time now')
    console.log('  time +MS')
    console.log('  time set YYYY-MM-DD HH:MM')
    console.log('  state')
    console.log('  config load <filename>')
    console.log('  help')
    console.log('  exit')
    console.log('')
  }
}

export default CliSimController
