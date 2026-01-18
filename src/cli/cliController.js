// src/cli/cliController.js
import readline from 'node:readline'
import eventTypes from '../core/eventTypes.js'
import makeCliCompleter from './cliCompleter.js'
import { printHelp } from './cliHelp.js'

export class CliController {
  #logger
  #parser
  #loadConfig
  #getContext
  #setContext
  #rl

  #injectEnabled

  constructor({ logger, parser, loadConfig, getContext, setContext, mode }) {
    this.#logger = logger
    this.#parser = parser
    this.#loadConfig = loadConfig
    this.#getContext = getContext
    this.#setContext = setContext
    this.#rl = null

    this.#injectEnabled = false
  }

  start() {
    if (this.#rl) {
      return
    }

    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: makeCliCompleter({ getContext: this.#getContext }),
    })

    const { taps } = this.#getContext()
    const tapLogger = this.#logger.child({ label: 'tap' })

    for (const tap of Object.values(taps || {})) {
      if (tap && typeof tap.setSink === 'function') {
        tap.setSink(({ bus, event }) => {
          if (!event?.type) {
            return
          }

          tapLogger.info(event.type, {
            bus,
            payload: event.payload,
            source: event.source,
            ts: event.ts,
          })
        })
      }
    }

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

    printHelp({ mode: 'local' })
    this.#updatePrompt()
    this.#rl.prompt()
  }

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
      printHelp()
      return
    }

    if (cmd.kind === 'error') {
      console.log(cmd.message)
      return
    }

    if (cmd.kind === 'exit') {
      process.exit(0)
    }

    if (cmd.kind === 'injectOn') {
      this.#injectEnabled = true
      this.#logger.notice('inject_enabled', {})
      return
    }

    if (cmd.kind === 'injectOff') {
      this.#injectEnabled = false
      this.#logger.notice('inject_disabled', {})
      return
    }

    if (cmd.kind === 'injectStatus') {
      this.#logger.info('inject_status', { enabled: this.#injectEnabled })
      return
    }

    if (cmd.kind === 'tapOn') {
      this.#setTap(cmd.bus, true)
      return
    }

    if (cmd.kind === 'tapOff') {
      this.#setTap(cmd.bus, false)
      return
    }

    if (cmd.kind === 'tapStatus') {
      this.#tapStatus(cmd.bus)
      return
    }

    if (cmd.kind === 'coreState') {
      const { core } = this.#getContext()
      this.#logger.info('snapshot', core.getSnapshot())
      return
    }

    if (cmd.kind === 'presence') {
      this.#guardInject(() => this.#publishPresence(cmd.zone, cmd.present))
      return
    }

    if (cmd.kind === 'vibration') {
      this.#guardInject(() => this.#publishVibration(cmd.level))
      return
    }

    if (cmd.kind === 'button') {
      this.#guardInject(() => this.#publishButton(cmd.pressType))
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
      const { config } = this.#getContext()
      this.#logger.info('config_print', config)
      return
    }

    if (cmd.kind === 'virtList') {
      this.#virtList()
      return
    }

    if (cmd.kind === 'virtSet') {
      this.#virtSet(cmd.sensorId, cmd.value)
      return
    }

    if (cmd.kind === 'virtPress') {
      this.#virtPress(cmd.sensorId, cmd.ms)
      return
    }

    if (cmd.kind === 'driverList') {
      this.#driverList()
      return
    }

    if (cmd.kind === 'driverEnable') {
      this.#driverSetEnabled(cmd.sensorId, true)
      return
    }

    if (cmd.kind === 'driverDisable') {
      this.#driverSetEnabled(cmd.sensorId, false)
      return
    }

    console.log('unknown command, type: help')
  }

  #getSignals() {
    const { deviceManager } = this.#getContext()
    const signals = deviceManager?.getSignals?.()
    return signals || {}
  }

  #virtList() {
    const signals = this.#getSignals()

    const listSettableIds = (m) => {
      if (!(m instanceof Map)) {
        return []
      }

      return Array.from(m.entries())
        .filter(([, sig]) => sig && typeof sig.set === 'function')
        .map(([id]) => id)
        .filter(Boolean)
        .sort()
    }

    const presence = listSettableIds(signals.presence)
    const vibration = listSettableIds(signals.vibration)
    const button = listSettableIds(signals.button)

    this.#logger.info('virt_signals', { presence, vibration, button })
  }

  #virtSet(sensorId, value) {
    const signals = this.#getSignals()

    const targets = [
      { name: 'presence', map: signals.presence },
      { name: 'vibration', map: signals.vibration },
      { name: 'button', map: signals.button },
    ]

    const matches = []

    for (const t of targets) {
      const m = t.map
      if (!(m instanceof Map)) {
        continue
      }

      const sig = m.get(sensorId)
      if (!sig) {
        continue
      }

      matches.push({ domain: t.name, sig })
    }

    if (matches.length === 0) {
      this.#logger.warning('virt_unknown_signal', { sensorId })
      return
    }

    if (matches.length > 1) {
      this.#logger.warning('virt_ambiguous_signal', {
        sensorId,
        domains: matches.map((x) => x.domain),
      })
      return
    }

    const { domain, sig } = matches[0]

    if (typeof sig.set !== 'function') {
      this.#logger.warning('virt_signal_not_settable', { sensorId, domain })
      return
    }

    sig.set(Boolean(value))
    this.#logger.notice('virt_set', { sensorId, domain, value: Boolean(value) })
  }

  #virtPress(sensorId, ms) {
    const signals = this.#getSignals()
    const m = signals?.button

    if (!(m instanceof Map)) {
      this.#logger.warning('virt_no_button_signals', { sensorId })
      return
    }

    const sig = m.get(sensorId)
    if (!sig) {
      this.#logger.warning('virt_unknown_signal', { sensorId })
      return
    }

    if (typeof sig.set !== 'function') {
      this.#logger.warning('virt_signal_not_settable', { sensorId })
      return
    }

    const holdMs = Number(ms) > 0 ? Number(ms) : 30

    sig.set(true)

    setTimeout(() => {
      sig.set(false)
      this.#logger.notice('virt_press', { sensorId, holdMs })
    }, holdMs)
  }

  #driverList() {
    const { deviceManager } = this.#getContext()

    if (!deviceManager || typeof deviceManager.list !== 'function') {
      this.#logger.warning('device_manager_missing', {})
      return
    }

    const out = deviceManager.list()
    const devices = Array.isArray(out?.devices) ? out.devices : []

    const items = devices.map((d) => ({
      sensorId: d.id,
      publishAs: d.publishAs ?? null,
      type: d.type ?? null,
      role: d.role ?? null,
      bus: d.bus ?? null,
      enabled: d.enabled ?? null,
      started: d.started ?? null,
      runtimeState: d.runtimeState ?? null,
    }))

    this.#logger.info('driver_list', { drivers: items })
  }

  #driverSetEnabled(sensorId, enabled) {
    const { deviceManager } = this.#getContext()

    if (!deviceManager) {
      this.#logger.warning('device_manager_missing', { sensorId })
      return
    }

    const id = String(sensorId || '').trim()
    if (!id) {
      this.#logger.warning('driver_not_found', { sensorId })
      return
    }

    const out = enabled === true
      ? deviceManager.unblock(id)
      : deviceManager.block(id)

    if (!out?.ok) {
      this.#logger.warning('driver_not_found', { sensorId: id })
      return
    }

    this.#logger.notice('driver_toggled', { sensorId: id, enabled: Boolean(enabled) })
  }

  #guardInject(fn) {
    if (!this.#injectEnabled) {
      this.#logger.warning('inject_blocked', { reason: 'inject_disabled' })
      return
    }

    fn()
  }

  #setTap(bus, enabled) {
    const { taps } = this.#getContext()

    if (bus === 'all') {
      for (const t of Object.values(taps)) {
        t.setEnabled(enabled)
      }

      return
    }

    const tap = taps?.[bus]
    if (!tap) {
      this.#logger.warning('tap_unknown_bus', { bus })
      return
    }

    tap.setEnabled(enabled)
  }

  #tapStatus(bus) {
    const { taps } = this.#getContext()

    if (bus === 'all') {
      const status = {}
      for (const [k, t] of Object.entries(taps)) {
        status[k] = t.isEnabled()
      }

      this.#logger.info('tap_status', status)
      return
    }

    const tap = taps?.[bus]
    if (!tap) {
      this.#logger.warning('tap_unknown_bus', { bus })
      return
    }

    this.#logger.info('tap_status', { [bus]: tap.isEnabled() })
  }

  #publishPresence(zone, present) {
    const { clock, buses, config } = this.#getContext()

    const sensors = Array.isArray(config?.sensors) ? config.sensors : []
    const match = sensors.find((s) =>
      s?.enabled !== false &&
      s?.role === 'presence' &&
      s?.zone === zone
    )

    if (!match) {
      this.#logger.warning('inject_presence_no_sensor', { zone })
      return
    }

    const event = {
      type: present ? eventTypes.presence.enter : eventTypes.presence.exit,
      ts: clock.nowMs(),
      source: 'cliInject',
      payload: { zone, sensorId: match.id },
    }

    this.#logger.debug('event_publish', { bus: 'main', event })
    buses.main.publish(event)
  }

  #publishVibration(level) {
    const { clock, buses, config } = this.#getContext()

    const mapped = level === 'high' ? 'heavy' : 'light'

    const sensors = Array.isArray(config?.sensors) ? config.sensors : []
    const match = sensors.find((s) =>
      s?.enabled !== false &&
      s?.role === 'vibration' &&
      (s?.level === mapped || s?.params?.level === mapped)
    )

    if (!match) {
      this.#logger.warning('inject_vibration_no_sensor', { level, mapped })
      return
    }

    const event = {
      type: eventTypes.vibration.hit,
      ts: clock.nowMs(),
      source: 'cliInject',
      payload: { level, mapped, sensorId: match.id },
    }

    this.#logger.debug('event_publish', { bus: 'main', event })
    buses.main.publish(event)
  }

  #publishButton(pressType) {
    const { clock, buses, config } = this.#getContext()

    const sensors = Array.isArray(config?.sensors) ? config.sensors : []
    const match = sensors.find((s) =>
      s?.enabled !== false &&
      s?.role === 'button'
    )

    if (!match) {
      this.#logger.warning('inject_button_no_sensor', { pressType })
      return
    }

    const event = {
      type: eventTypes.button.press,
      ts: clock.nowMs(),
      source: 'cliInject',
      payload: { kind: pressType, sensorId: match.id },
    }

    this.#logger.debug('event_publish', { bus: 'main', event })
    buses.main.publish(event)
  }

  #reloadConfig(filename) {
    try {
      const { config } = this.#loadConfig(filename)
      this.#setContext({ config })
      this.#logger.notice('config_loaded', { configFile: filename })
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

  #updatePrompt() {
    const { clock } = this.#getContext()
    const glyph = clock.isFrozen() ? '❄' : '▶'
    const inj = this.#injectEnabled ? '✓' : '×'
    this.#rl.setPrompt(`charlie(${glyph} inject:${inj})> `)
  }
}

export default CliController
