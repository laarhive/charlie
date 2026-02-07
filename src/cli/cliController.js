// src/cli/cliController.js
import readline from 'node:readline'
import makeCliCompleter from './cliCompleter.js'
import { printHelp } from './cliHelp.js'
import eventTypes from '../core/eventTypes.js'
import formatError from '../core/errorFormat.js'
import { handleRecording } from './recording/cliRecording.js'

export class CliController {
  #logger
  #parser
  #loadConfig
  #getContext
  #setContext
  #rl

  #injectEnabled
  #cache

  constructor({ logger, parser, loadConfig, getContext, setContext }) {
    this.#logger = logger
    this.#parser = parser
    this.#loadConfig = loadConfig ?? null
    this.#getContext = getContext
    this.#setContext = setContext ?? null

    this.#rl = null
    this.#injectEnabled = false

    this.#cache = {
      config: null,
      devices: [],
    }
  }

  start() {
    if (this.#rl) return

    this.#refreshCache()

    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: makeCliCompleter({ getContext: () => this.#getCompletionContext() }),
    })

    this.#rl.on('line', (line) => {
      const cmd = this.#parser.parse(line)

      Promise.resolve()
        .then(async () => {
          await this.#handleCommand(cmd)
        })
        .catch((e) => {
          const fe = formatError(e)
          this.#logger?.error?.('cli_command_failed', { error: fe })
          console.log(fe?.message || 'error')
          if (fe?.stack) console.log(fe.stack)
        })
        .finally(() => {
          this.#updatePrompt()
          this.#rl.prompt()
        })
    })

    this.#rl.on('close', () => {
      this.#logger.notice('cli_closed', {})
      process.exit(0)
    })

    printHelp({ mode: 'local' })
    this.#updatePrompt()
    this.#rl.prompt()
  }

  dispose() {
    if (!this.#rl) return
    this.#rl.close()
    this.#rl = null
  }

  #ctx() {
    const ctx = this.#getContext?.()
    if (!ctx) {
      const err = new Error('context_missing')
      err.code = 'INTERNAL_ERROR'
      throw err
    }
    return ctx
  }

  #refreshCache() {
    const ctx = this.#ctx()

    this.#cache.config = ctx?.config ?? {}

    if (ctx?.deviceManager?.list) {
      const out = ctx.deviceManager.list()
      this.#cache.devices = Array.isArray(out?.devices) ? out.devices : []
    } else {
      this.#cache.devices = []
    }

    const snap = ctx?.control?.getSnapshot ? ctx.control.getSnapshot() : {}
    if (typeof snap?.injectEnabled === 'boolean') {
      this.#injectEnabled = snap.injectEnabled
    }
  }

  #getCompletionContext() {
    const ctx = this.#ctx()

    return {
      config: this.#cache.config ?? {},
      recordingService: ctx?.recordingService ?? null,
    }
  }

  async #handleCommand(cmd) {
    if (cmd.kind === 'empty') return

    if (cmd.kind === 'help') {
      printHelp({ mode: 'local' })
      return
    }

    if (cmd.kind === 'error') {
      console.log(cmd.message)
      return
    }

    if (cmd.kind === 'exit') {
      process.exit(0)
    }

    if (cmd.kind === 'injectOn') return this.#injectOn()
    if (cmd.kind === 'injectOff') return this.#injectOff()
    if (cmd.kind === 'injectStatus') return this.#injectStatus()

    if (cmd.kind === 'coreState') return this.#coreState()

    if (cmd.kind === 'configPrint') return this.#configPrint()

    if (cmd.kind === 'configLoad') {
      this.#reloadConfig(cmd.filename)
      this.#refreshCache()
      return
    }

    if (cmd.kind === 'presence') return this.#guardInject(() => this.#injectPresence(cmd.zone, cmd.present))
    if (cmd.kind === 'vibration') return this.#guardInject(() => this.#injectVibration(cmd.level))
    if (cmd.kind === 'button') return this.#guardInject(() => this.#injectButton(cmd.pressType))

    if (cmd.kind === 'clockNow') return this.#clockNow()
    if (cmd.kind === 'clockStatus') return this.#clockStatus()
    if (cmd.kind === 'clockFreeze') return this.#clockFreeze()
    if (cmd.kind === 'clockResume') return this.#clockResume()
    if (cmd.kind === 'clockAdvance') return this.#clockAdvance(cmd.ms)
    if (cmd.kind === 'clockSet') return this.#clockSet(cmd.dateStr, cmd.timeStr)

    if (cmd.kind === 'deviceList') return this.#deviceList()
    if (cmd.kind === 'deviceBlock') return this.#deviceBlock(cmd.deviceId)
    if (cmd.kind === 'deviceUnblock') return this.#deviceUnblock(cmd.deviceId)
    if (cmd.kind === 'deviceInject') return this.#deviceInject(cmd.deviceId, cmd.payload)

    if (cmd.kind === 'recording') {
      const ctx = this.#ctx()
      await handleRecording({ ctx, logger: this.#logger }, cmd)
      return
    }

    console.log('unknown command, type: help')
  }

  #injectOn() {
    const ctx = this.#ctx()

    if (!ctx?.control?.injectEnable) {
      console.log('inject is not supported')
      return
    }

    const out = ctx.control.injectEnable()
    this.#injectEnabled = Boolean(out?.injectEnabled)
    this.#logger.notice('inject_enabled', {})
  }

  #injectOff() {
    const ctx = this.#ctx()

    if (!ctx?.control?.injectDisable) {
      console.log('inject is not supported')
      return
    }

    const out = ctx.control.injectDisable()
    this.#injectEnabled = Boolean(out?.injectEnabled)
    this.#logger.notice('inject_disabled', {})
  }

  #injectStatus() {
    const ctx = this.#ctx()
    const snap = ctx?.control?.getSnapshot ? ctx.control.getSnapshot() : {}

    if (typeof snap?.injectEnabled === 'boolean') {
      this.#injectEnabled = snap.injectEnabled
    }

    this.#logger.info('inject_status', { enabled: this.#injectEnabled })
  }

  #guardInject(fn) {
    const ctx = this.#ctx()
    const snap = ctx?.control?.getSnapshot ? ctx.control.getSnapshot() : {}

    if (typeof snap?.injectEnabled === 'boolean') {
      this.#injectEnabled = snap.injectEnabled
    }

    if (!this.#injectEnabled) {
      this.#logger.warning('inject_blocked', { reason: 'inject_disabled' })
      return
    }

    fn()
  }

  #defaults() {
    const cfg = this.#cache.config ?? {}
    return cfg?.core?.injectDefaults ?? {}
  }

  #injectPresence(zone, present) {
    const ctx = this.#ctx()
    const defaults = this.#defaults()

    const key = zone === 'front' ? 'presenceFront' : 'presenceBack'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'presence', zone })
      return
    }

    if (!ctx?.control?.injectEvent) {
      console.log('inject is not supported')
      return
    }

    ctx.control.injectEvent({
      bus: 'main',
      type: present ? eventTypes.presence.enter : eventTypes.presence.exit,
      payload: { coreRole, zone },
      source: 'cli',
    })
  }

  #injectVibration(level) {
    const ctx = this.#ctx()
    const defaults = this.#defaults()

    const key = level === 'high' ? 'vibrationHigh' : 'vibrationLow'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'vibration', level })
      return
    }

    if (!ctx?.control?.injectEvent) {
      console.log('inject is not supported')
      return
    }

    ctx.control.injectEvent({
      bus: 'main',
      type: eventTypes.vibration.hit,
      payload: { coreRole, level },
      source: 'cli',
    })
  }

  #injectButton(pressType) {
    const ctx = this.#ctx()
    const defaults = this.#defaults()

    const key = pressType === 'long' ? 'buttonLong' : 'buttonShort'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'button', pressType })
      return
    }

    if (!ctx?.control?.injectEvent) {
      console.log('inject is not supported')
      return
    }

    ctx.control.injectEvent({
      bus: 'main',
      type: eventTypes.button.press,
      payload: { coreRole, kind: pressType },
      source: 'cli',
    })
  }

  #coreState() {
    const ctx = this.#ctx()

    if (!ctx?.core?.getSnapshot) {
      console.log('core snapshot not available')
      return
    }

    this.#logger.info('snapshot', ctx.core.getSnapshot())
  }

  #configPrint() {
    const ctx = this.#ctx()
    this.#logger.info('config_print', ctx?.config ?? {})
  }

  #reloadConfig(filename) {
    if (!this.#loadConfig || !this.#setContext) {
      console.log('config load is not available')
      return
    }

    try {
      const loaded = this.#loadConfig(filename)
      const config = loaded?.config ?? null
      if (!config) {
        console.log('config load failed')
        return
      }

      this.#setContext({ config })
      this.#logger.notice('config_loaded', { configFile: filename })
    } catch (e) {
      const fe = formatError(e)
      this.#logger.error('config_load_failed', { configFile: filename, error: fe })
    }
  }

  #deviceList() {
    const ctx = this.#ctx()
    const dm = ctx?.deviceManager

    if (!dm?.list) {
      this.#logger.warning('device_manager_missing', {})
      return
    }

    const out = dm.list()
    this.#cache.devices = Array.isArray(out?.devices) ? out.devices : []
    this.#logger.info('device_list', { devices: this.#cache.devices })
  }

  #deviceBlock(deviceId) {
    const ctx = this.#ctx()
    const dm = ctx?.deviceManager

    if (!dm?.block) {
      this.#logger.warning('device_manager_missing', { deviceId })
      return
    }

    const out = dm.block(deviceId)
    if (!out?.ok) {
      this.#logger.warning('device_block_failed', { deviceId, error: out?.error })
      return
    }

    this.#logger.notice('device_blocked', { deviceId })
    this.#deviceList()
  }

  #deviceUnblock(deviceId) {
    const ctx = this.#ctx()
    const dm = ctx?.deviceManager

    if (!dm?.unblock) {
      this.#logger.warning('device_manager_missing', { deviceId })
      return
    }

    const out = dm.unblock(deviceId)
    if (!out?.ok) {
      this.#logger.warning('device_unblock_failed', { deviceId, error: out?.error })
      return
    }

    this.#logger.notice('device_unblocked', { deviceId })
    this.#deviceList()
  }

  #deviceInject(deviceId, payload) {
    const ctx = this.#ctx()
    const dm = ctx?.deviceManager

    if (!dm?.inject) {
      this.#logger.warning('device_manager_missing', { deviceId })
      return
    }

    const out = dm.inject(deviceId, payload)
    if (!out?.ok) {
      this.#logger.warning('device_inject_failed', { deviceId, error: out?.error, message: out?.message })
      return
    }

    this.#logger.notice('device_injected', { deviceId })
  }

  #clockNow() {
    const ctx = this.#ctx()
    const { clock, core } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    const parts = clock.toLocalParts()
    const snap = core?.getSnapshot ? core.getSnapshot() : {}

    this.#logger.info('clock_now', {
      ...parts,
      isFrozen: clock.isFrozen(),
      nowMs: clock.nowMs(),
      state: snap.state,
    })
  }

  #clockStatus() {
    const ctx = this.#ctx()
    const { clock } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    const parts = clock.toLocalParts()

    this.#logger.info('clock_status', {
      ...parts,
      isFrozen: clock.isFrozen(),
      nowMs: clock.nowMs(),
    })
  }

  #clockFreeze() {
    const ctx = this.#ctx()
    const { clock } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    clock.freeze()
    this.#logger.notice('clock_frozen', { nowMs: clock.nowMs() })
  }

  #clockResume() {
    const ctx = this.#ctx()
    const { clock } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    clock.resume()
    this.#logger.notice('clock_resumed', { nowMs: clock.nowMs() })
  }

  #clockAdvance(ms) {
    const ctx = this.#ctx()
    const { clock } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    clock.advance(ms)
    this.#logger.info('clock_advanced', { deltaMs: ms, nowMs: clock.nowMs(), isFrozen: clock.isFrozen() })
  }

  #clockSet(dateStr, timeStr) {
    const dt = this.#parseDateTime(dateStr, timeStr)
    if (!dt) {
      console.log('invalid datetime, usage: clock set YYYY-MM-DD HH:MM')
      return
    }

    const ctx = this.#ctx()
    const { clock } = ctx

    if (!clock) {
      console.log('clock not available')
      return
    }

    clock.setLocalDateTime(dt)
    this.#logger.notice('clock_set', { ...dt, nowMs: clock.nowMs(), isFrozen: clock.isFrozen() })
  }

  #parseDateTime(dateStr, timeStr) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
    const tm = /^(\d{2}):(\d{2})$/.exec(timeStr)

    if (!dm || !tm) return null

    const year = Number(dm[1])
    const month = Number(dm[2])
    const day = Number(dm[3])
    const hour = Number(tm[1])
    const minute = Number(tm[2])

    if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null

    return { year, month, day, hour, minute }
  }

  #updatePrompt() {
    const ctx = this.#ctx()
    const clock = ctx?.clock

    const glyph = clock?.isFrozen?.() ? '❄' : '▶'
    const inj = this.#injectEnabled ? '✓' : '×'
    this.#rl.setPrompt(`charlie(${glyph} inject:${inj})> `)
  }
}

export default CliController
