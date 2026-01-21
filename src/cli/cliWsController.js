// src/cli/cliWsController.js
import readline from 'node:readline'
import eventTypes from '../core/eventTypes.js'
import makeCliCompleter from './cliCompleter.js'
import CharlieRpcClient from '../transport/clients/charlieRpcClient.js'
import CharlieStreamClient from '../transport/clients/charlieStreamClient.js'
import { printHelp } from './cliHelp.js'

/**
 * Remote CLI controller over WebSockets.
 *
 * Uses two sockets:
 * - /rpc for request/response commands
 * - /ws for bus streaming (server-pushed bus.event)
 *
 * Bus streaming selection is configured by the wsUrl you pass in, e.g:
 * - ws://host:8787/ws?all
 * - ws://host:8787/ws?main&button
 */
export class CliWsController {
  #logger
  #parser
  #rpcUrl
  #streamUrl
  #rl

  #rpc
  #stream

  #injectEnabled

  #cache

  constructor({ logger, parser, wsUrl, rpcUrl, streamUrl, rpcClient, streamClient }) {
    this.#logger = logger
    this.#parser = parser

    /*
      Backward-compatible constructor:
      - previously: wsUrl pointed to a single /ws endpoint
      - now: prefer explicit rpcUrl + streamUrl
    */
    const base = (() => {
      const u = String(wsUrl || '').trim()
      if (!u) {
        return ''
      }

      // best-effort: strip any /ws or /rpc suffix
      return u
        .replace(/\/ws(\?.*)?$/i, '')
        .replace(/\/rpc(\?.*)?$/i, '')
    })()

    this.#rpcUrl = String(rpcUrl || '').trim() || (base ? `${base}/rpc` : '')
    this.#streamUrl = String(streamUrl || '').trim() || (base ? `${base}/ws?main` : '')

    this.#rl = null

    this.#rpc = rpcClient ?? new CharlieRpcClient({ logger, url: this.#rpcUrl })
    this.#stream = streamClient ?? new CharlieStreamClient({ logger, url: this.#streamUrl })

    this.#injectEnabled = false

    this.#cache = {
      config: null,
      devices: [],
    }
  }

  async handleCommand(cmd) {
    await this.#handleCommand(cmd)
  }

  async init() {
    await this.#rpc.connect()
    await this.#stream.connect()

    this.#stream.onBusEvent((payload) => {
      this.#printBusEvent(payload)
    })

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
      const res = await this.#rpc.request('inject.enable')
      this.#injectEnabled = Boolean(res?.injectEnabled)
      this.#logger.notice('inject_enabled', {})
      return
    }

    if (cmd.kind === 'injectOff') {
      const res = await this.#rpc.request('inject.disable')
      this.#injectEnabled = Boolean(res?.injectEnabled)
      this.#logger.notice('inject_disabled', {})
      return
    }

    if (cmd.kind === 'injectStatus') {
      const snap = await this.#rpc.request('state.get')

      if (typeof snap?.injectEnabled === 'boolean') {
        this.#injectEnabled = snap.injectEnabled
      }

      this.#logger.info('inject_status', { enabled: this.#injectEnabled })
      return
    }

    /*
      Taps are deprecated. Streaming selection is chosen by streamUrl query params.
      Keep commands but explain the new model.
    */
    if (cmd.kind === 'tapOn' || cmd.kind === 'tapOff') {
      console.log('tap commands are deprecated. Select buses via stream URL query params (e.g. /ws?all or /ws?main&button).')
      return
    }

    if (cmd.kind === 'tapStatus') {
      console.log('tap status is deprecated. Current streaming selection is controlled by streamUrl query params.')
      return
    }

    if (cmd.kind === 'coreState') {
      const snap = await this.#rpc.request('state.get')
      this.#logger.info('snapshot', snap)
      return
    }

    if (cmd.kind === 'configPrint') {
      const cfg = await this.#rpc.request('config.get')
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
      const res = await this.#rpc.request('device.list')
      this.#cache.devices = Array.isArray(res?.devices) ? res.devices : []
      this.#logger.info('device_list', { devices: this.#cache.devices })
      return
    }

    if (cmd.kind === 'deviceBlock') {
      await this.#rpc.request('device.block', { deviceId: cmd.deviceId })
      await this.#refreshDevicesOnly()
      this.#logger.notice('device_blocked', { deviceId: cmd.deviceId })
      return
    }

    if (cmd.kind === 'deviceUnblock') {
      await this.#rpc.request('device.unblock', { deviceId: cmd.deviceId })
      await this.#refreshDevicesOnly()
      this.#logger.notice('device_unblocked', { deviceId: cmd.deviceId })
      return
    }

    if (cmd.kind === 'deviceInject') {
      await this.#rpc.request('device.inject', { deviceId: cmd.deviceId, payload: cmd.payload })
      this.#logger.notice('device_injected', { deviceId: cmd.deviceId })
      return
    }

    console.log('unknown command, type: help')
  }

  async #refreshCache() {
    await this.#refreshDevicesOnly()

    try {
      const cfg = await this.#rpc.request('config.get')
      this.#cache.config = cfg
    } catch {
      this.#cache.config = null
    }

    try {
      const st = await this.#rpc.request('state.get')
      if (typeof st?.injectEnabled === 'boolean') {
        this.#injectEnabled = st.injectEnabled
      }
    } catch {
      // ignore
    }
  }

  async #refreshDevicesOnly() {
    try {
      const res = await this.#rpc.request('device.list')
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

      // Taps are deprecated; completer can live without them
      taps: {},

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

  async #injectPresence(zone, present) {
    const cfg = this.#cache.config ?? {}
    const defaults = cfg?.core?.injectDefaults ?? {}

    const key = zone === 'front' ? 'presenceFront' : 'presenceBack'
    const coreRole = defaults?.[key] ?? null

    if (!coreRole) {
      this.#logger.warning('inject_missing_coreRole', { kind: 'presence', zone })
      return
    }

    await this.#rpc.request('inject.event', {
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

    await this.#rpc.request('inject.event', {
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

    await this.#rpc.request('inject.event', {
      bus: 'main',
      type: eventTypes.button.press,
      payload: { coreRole, kind: pressType },
      source: 'cliWsInject',
    })
  }

  #printBusEvent(payload) {
    const bus = payload?.bus
    const evt = payload?.event

    if (!evt?.type) {
      return
    }

    console.log(`[stream ${bus}] ${evt.type}`)
  }

  #updatePrompt() {
    const inj = this.#injectEnabled ? '✓' : '×'
    this.#rl.setPrompt(`charlie(ws inject:${inj})> `)
  }
}

export default CliWsController
