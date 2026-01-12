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

  constructor({ logger, parser, wsUrl }) {
    this.#logger = logger
    this.#parser = parser
    this.#wsUrl = wsUrl

    this.#rl = null
    this.#client = new CharlieWsClient({ logger, url: wsUrl })

    this.#injectEnabled = false
    this.#tapSubs = new Map()

    this.#cache = {
      config: null,
      drivers: [],
    }
  }

  async start() {
    if (this.#rl) {
      return
    }

    await this.#client.connect()
    await this.#refreshCache()

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
        await this.#handleCommand(cmd)
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

    if (cmd.kind === 'virtList' || cmd.kind === 'virtSet') {
      console.log('virt commands are local-only and not available via WS CLI')
      return
    }

    if (cmd.kind === 'clockNow' ||
      cmd.kind === 'clockStatus' ||
      cmd.kind === 'clockFreeze' ||
      cmd.kind === 'clockResume' ||
      cmd.kind === 'clockAdvance' ||
      cmd.kind === 'clockSet'
    ) {
      console.log('clock commands are not available via WS CLI yet')
      return
    }

    if (cmd.kind === 'driverList') {
      const res = await this.#client.request('driver.list')
      this.#cache.drivers = Array.isArray(res?.drivers) ? res.drivers : []
      this.#logger.info('driver_list', { drivers: this.#cache.drivers })
      return
    }

    if (cmd.kind === 'driverEnable') {
      await this.#client.request('driver.enable', { sensorId: cmd.sensorId })
      await this.#refreshDriversOnly()
      this.#logger.notice('driver_toggled', { sensorId: cmd.sensorId, enabled: true })
      return
    }

    if (cmd.kind === 'driverDisable') {
      await this.#client.request('driver.disable', { sensorId: cmd.sensorId })
      await this.#refreshDriversOnly()
      this.#logger.notice('driver_toggled', { sensorId: cmd.sensorId, enabled: false })
      return
    }

    console.log('unknown command, type: help')
  }

  async #refreshCache() {
    await this.#refreshDriversOnly()

    try {
      const cfg = await this.#client.request('config.get')
      this.#cache.config = cfg
    } catch (e) {
      this.#cache.config = null
    }

    try {
      const st = await this.#client.request('state.get')
      if (typeof st?.injectEnabled === 'boolean') {
        this.#injectEnabled = st.injectEnabled
      }
    } catch (e) {
      // ignore
    }
  }

  async #refreshDriversOnly() {
    try {
      const res = await this.#client.request('driver.list')
      this.#cache.drivers = Array.isArray(res?.drivers) ? res.drivers : []
    } catch (e) {
      this.#cache.drivers = []
    }
  }

  #getRemoteContext() {
    const driverBySensorId = new Map()
    for (const d of this.#cache.drivers) {
      if (d?.id) {
        driverBySensorId.set(d.id, d)
      }
    }

    return {
      config: this.#cache.config ?? {},
      hw: { driverBySensorId },
      taps: {},

      /*
        cliCompleter may look for these keys even if unused.
        Keep them present but minimal.
      */
      buses: {},
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
    const sensors = Array.isArray(cfg?.sensors) ? cfg.sensors : []

    const match = sensors.find((s) =>
      s?.enabled &&
      s?.role === 'presence' &&
      s?.zone === zone
    )

    if (!match) {
      this.#logger.warning('inject_presence_no_sensor', { zone })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: present ? eventTypes.presence.enter : eventTypes.presence.exit,
      payload: { zone, sensorId: match.id },
      source: 'cliWsInject',
    })
  }

  async #injectVibration(level) {
    const cfg = this.#cache.config ?? {}
    const sensors = Array.isArray(cfg?.sensors) ? cfg.sensors : []

    const mapped = level === 'high' ? 'heavy' : 'light'

    const match = sensors.find((s) =>
      s?.enabled &&
      s?.role === 'vibration' &&
      (s?.level === mapped || s?.params?.level === mapped)
    )

    if (!match) {
      this.#logger.warning('inject_vibration_no_sensor', { level, mapped })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: eventTypes.vibration.hit,
      payload: { level, mapped, sensorId: match.id },
      source: 'cliWsInject',
    })
  }

  async #injectButton(pressType) {
    const cfg = this.#cache.config ?? {}
    const sensors = Array.isArray(cfg?.sensors) ? cfg.sensors : []

    const match = sensors.find((s) =>
      s?.enabled &&
      s?.role === 'button'
    )

    if (!match) {
      this.#logger.warning('inject_button_no_sensor', { pressType })
      return
    }

    await this.#client.request('inject.event', {
      bus: 'main',
      type: eventTypes.button.press,
      payload: { kind: pressType, sensorId: match.id },
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
