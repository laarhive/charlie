// src/cli/cliWsController.js
import readline from 'node:readline'
import eventTypes from '../core/eventTypes.js'
import makeCliCompleter from './cliCompleter.js'
import CharlieWsClient from './charlieWsClient.js'
import { printHelp } from './cliHelp.js'

export class CliWsController {
  #logger
  #parser
  #wsUrl
  #rl
  #client

  #injectEnabled
  #tapSubs

  #cache

  constructor({ logger, parser, wsUrl, client }) {
    this.#logger = logger
    this.#parser = parser
    this.#wsUrl = wsUrl

    this.#rl = null
    this.#client = client ?? new CharlieWsClient({ logger, url: wsUrl })

    this.#injectEnabled = false
    this.#tapSubs = new Map()

    this.#cache = {
      config: null,
      devices: [],
    }
  }

  async handleCommand(cmd) {
    await this.#handleCommand(cmd)
  }

  async init() {
    await this.#client.connect()
    await this.#refreshCache()

    if (!this.#cache?.config) {
      this.#cache.config = {}
    }
  }

  async start() {
    if (this.#rl) {
      return
    }

    await this.init()

    this.#client.onBusEvent((payload) => {
      this.#printBusEvent(payload)
    })

    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: makeCliCompleter({ getContext: () => this.#getRemoteContext() }),
    })

    this.#rl.on('line', async (line) => {
      const cmd = this.#parser.parse(line)

      try {
        await this.handleCommand(cmd)
      } catch (e) {
        console.log(String(e?.message || e))
      }

      this.#updatePrompt()
      this.#rl.prompt()
    })

    this.#rl.on('close', () => {
      this.#logger.notice('cli_closed', {})
      process.exit(0)
    })

    // WS CLI is still a CLI, just remote. We print the same help.
    printHelp({ mode: 'ws' })
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

  async #handleCommand(cmd) {
    if (cmd.kind === 'empty') {
      return
    }

    if (cmd.kind === 'help') {
      printHelp({ mode: 'ws' })
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
      const res = await this.#client.request('inject.enable')
      this.#injectEnabled = Boolean(res?.injectEnabled)
      this.#logger.notice('inject_enabled', {})
      return
    }

    if (cmd.kind === 'injectOff') {
      const res = await this.#client.request('inject.disable')
      this.#injectEnabled = Boolean(res?.injectEnabled)
      this.#logger.notice('inject_disabled', {})
      return
    }

    if (cmd.kind === 'injectStatus') {
      const snap = await this.#client.request('state.get')

      if (typeof snap?.injectEnabled === 'boolean') {
        this.#injectEnabled = snap.injectEnabled
      }

      this.#logger.info('inject_status', { enabled: this.#injectEnabled })
      return
    }

    if (cmd.kind === 'tapOn') {
      await this.#tapSet(cmd.bus, true)
      return
    }

    if (cmd.kind === 'tapOff') {
      await this.#tapSet(cmd.bus, false)
      return
    }

    if (cmd.kind === 'tapStatus') {
      this.#tapStatus(cmd.bus)
      return
    }

    if (cmd.kind === 'coreState') {
      const snap = await this.#client.request('state.get')
      this.#logger.info('snapshot', snap)
      return
    }

    if (cmd.kind === 'configPrint') {
      const cfg = await this.#client.request('config.get')
      this.#logger.info('config_print', cfg)
      return
    }

    if (cmd.kind === 'configLoad') {
      console.log('config load is not supported via WS yet (needs daemon-side config.set/reload)')
      return
    }

    if (cmd.kind === 'presence') {
      await this.#guardInject(async () => this.#injectPresence(cmd.zone, cmd.present))
      return
    }

    if (cmd.kind === 'vibration') {
      await this.#guardInject(async () => this.#injectVibration(cmd.level))
      return
    }

    if (cmd.kind === 'button') {
      await this.#guardInject(async () => this.#injectButton(cmd.pressType))
      return
    }

    if (cmd.kind === 'virtList' || cmd.kind === 'virtSet' || cmd.kind === 'virtPress') {
      console.log('virt commands are local-only and not available via WS CLI')
      return
    }

    if (
      cmd.kind === 'clockNow' ||
      cmd.kind === 'clockStatus' ||
      cmd.kind === 'clockFreeze' ||
      cmd.kind === 'clockResume' ||
      cmd.kind === 'clockAdvance' ||
      cmd.kind === 'clockSet'
    ) {
      console.log('clock commands are not available via WS CLI yet')
      return
    }

    if (cmd.kind === 'deviceList') {
      const res = await this.#client.request('device.list')
      this.#cache.devices = Array.isArray(res?.devices) ? res.devices : []
      this.#logger.info('device_list', { devices: this.#cache.devices })
      return
    }

    if (cmd.kind === 'deviceBlock') {
      await this.#client.request('device.block', { deviceId: cmd.deviceId })
      await this.#refreshDevicesOnly()
      this.#logger.notice('device_blocked', { deviceId: cmd.deviceId })
      return
    }

    if (cmd.kind === 'deviceUnblock') {
      await this.#client.request('device.unblock', { deviceId: cmd.deviceId })
      await this.#refreshDevicesOnly()
      this.#logger.notice('device_unblocked', { deviceId: cmd.deviceId })
      return
    }

    if (cmd.kind === 'deviceInject') {
      await this.#client.request('device.inject', { deviceId: cmd.deviceId, payload: cmd.payload })
      this.#logger.notice('device_injected', { deviceId: cmd.deviceId })
      return
    }

    console.log('unknown command, type: help')
  }

  async #refreshCache() {
    await this.#refreshDevicesOnly()

    try {
      const cfg = await this.#client.request('config.get')
      this.#cache.config = cfg
    } catch {
      this.#cache.config = null
    }

    try {
      const st = await this.#client.request('state.get')
      if (typeof st?.injectEnabled === 'boolean') {
        this.#injectEnabled = st.injectEnabled
      }
    } catch {
      // ignore
    }
  }

  async #refreshDevicesOnly() {
    try {
      const res = await this.#client.request('device.list')
      this.#cache.devices = Array.isArray(res?.devices) ? res.devices : []
    } catch {
      this.#cache.devices = []
    }
  }

  #getRemoteContext() {
    const cfg = this.#cache.config ?? {}
    const devices = Array.isArray(cfg?.devices) ? cfg.devices : []

    return {
      config: {
        ...cfg,
        devices,
      },

      // For completer: it expects buses in some cases
      buses: {},

      // Taps are handled on the server; completer can live without them
      taps: {},

      // Present but unused by completer
      core: {},
      clock: {},
    }
  }

  async #guardInject(fn) {
    if (!this.#injectEnabled) {
      this.#logger.warning('inject_blocked', { reason: 'inject_disabled' })
      return
    }

    await fn()
  }

  async #tapSet(bus, enabled) {
    const buses = ['main', 'presence', 'vibration', 'button', 'tasker']

    if (bus === 'all') {
      for (const b of buses) {
        await this.#tapSet(b, enabled)
      }

      return
    }

    if (!buses.includes(bus)) {
      this.#logger.warning('tap_unknown_bus', { bus })
      return
    }

    if (enabled) {
      if (this.#tapSubs.has(bus)) {
        return
      }

      const res = await this.#client.request('bus.tap.start', { bus })
      const subId = res?.subId

      if (!subId) {
        this.#logger.warning('tap_start_failed', { bus })
        return
      }

      this.#tapSubs.set(bus, subId)
      return
    }

    const subId = this.#tapSubs.get(bus)
    if (!subId) {
      return
    }

    await this.#client.request('bus.tap.stop', { subId })
    this.#tapSubs.delete(bus)
  }

  #tapStatus(bus) {
    const buses = ['main', 'presence', 'vibration', 'button', 'tasker']

    if (bus === 'all') {
      const status = {}
      for (const b of buses) {
        status[b] = this.#tapSubs.has(b)
      }

      this.#logger.info('tap_status', status)
      return
    }

    if (!buses.includes(bus)) {
      this.#logger.warning('tap_unknown_bus', { bus })
      return
    }

    this.#logger.info('tap_status', { [bus]: this.#tapSubs.has(bus) })
  }

  async #injectPresence(zone, present) {
    const cfg = this.#cache.config ?? {}
    const defaults = cfg?.core?.injectDefaults ?? {}

    const key = zone === 'front' ? 'presenceFront' : 'presenceBack'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'presence', zone })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: present ? eventTypes.presence.enter : eventTypes.presence.exit,
      payload: { coreRole, zone },
      source: 'cliWsInject',
    })
  }

  async #injectVibration(level) {
    const cfg = this.#cache.config ?? {}
    const defaults = cfg?.core?.injectDefaults ?? {}

    const key = level === 'high' ? 'vibrationHigh' : 'vibrationLow'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'vibration', level })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: eventTypes.vibration.hit,
      payload: { coreRole, level },
      source: 'cliWsInject',
    })
  }

  async #injectButton(pressType) {
    const cfg = this.#cache.config ?? {}
    const defaults = cfg?.core?.injectDefaults ?? {}

    const key = pressType === 'long' ? 'buttonLong' : 'buttonShort'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'button', pressType })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: eventTypes.button.press,
      payload: { coreRole, kind: pressType },
      source: 'cliWsInject',
    })
  }

  #printBusEvent(payload) {
    const bus = payload?.bus
    const evt = payload?.event
    const subId = payload?.subId

    if (!evt?.type) {
      return
    }

    console.log(`[tap ${bus} ${subId}] ${evt.type}`)
  }

  #updatePrompt() {
    const inj = this.#injectEnabled ? '✓' : '×'
    this.#rl.setPrompt(`charlie(ws inject:${inj})> `)
  }
}

export default CliWsController
