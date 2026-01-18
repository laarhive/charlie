// src/devices/deviceManager.js
import eventTypes from '../core/eventTypes.js'
import ProtocolFactory from './protocols/protocolFactory.js'
import makeDeviceInstance from './kinds/index.js'

/**
 * Device Manager
 *
 * Responsibilities:
 * - Activates devices based on (modes + state)
 * - Instantiates device kinds (registry) and tracks instances
 * - Calls device.start()/block()/unblock()
 * - Publishes `system:hardware` on main bus for state changes
 *
 * Notes:
 * - DeviceManager does not create protocols. Devices do.
 * - Recovery is device-specific: DeviceManager calls device.unblock().
 *
 * @example
 * const dm = new DeviceManager({ logger, mainBus: buses.main, buses, clock, config, mode })
 * dm.start()
 */
export class DeviceManager {
  #logger
  #mainBus
  #buses
  #clock
  #config
  #mode

  #protocolFactory

  #deviceConfigById
  #deviceById
  #runtimeStateById

  constructor({ logger, mainBus, buses, clock, config, mode }) {
    this.#logger = logger
    this.#mainBus = mainBus
    this.#buses = buses
    this.#clock = clock
    this.#config = config
    this.#mode = mode

    this.#protocolFactory = new ProtocolFactory({ logger, clock, config })

    this.#deviceConfigById = new Map()
    this.#deviceById = new Map()
    this.#runtimeStateById = new Map()
  }

  start() {
    const devices = Array.isArray(this.#config?.devices) ? this.#config.devices : []

    for (const d of devices) {
      if (!d?.id) {
        continue
      }

      this.#deviceConfigById.set(d.id, d)
    }

    for (const cfg of devices) {
      const id = cfg?.id
      if (!id) {
        continue
      }

      const configuredState = cfg?.state ?? 'active'
      if (configuredState === 'manualBlocked') {
        this.#setRuntimeState(id, 'manualBlocked', { phase: 'config' })
        continue
      }

      const modes = Array.isArray(cfg?.modes) ? cfg.modes : []
      if (!modes.includes(this.#mode)) {
        continue
      }

      this.#ensureStarted(cfg, { reason: 'startup' })
    }

    this.#logger.notice('device_manager_started', {
      mode: this.#mode,
      devices: this.#deviceById.size,
    })
  }

  dispose() {
    for (const [id, d] of this.#deviceById.entries()) {
      try {
        d.dispose()
      } catch (e) {
        this.#logger.error('device_dispose_failed', { deviceId: id, error: e?.message || String(e) })
      }
    }

    this.#deviceById.clear()
    this.#deviceConfigById.clear()
    this.#runtimeStateById.clear()

    this.#logger.notice('device_manager_disposed', {})
  }

  list() {
    const devices = []

    for (const cfg of this.#deviceConfigById.values()) {
      const id = cfg.id
      const runtimeState = this.#runtimeStateById.get(id) || 'unknown'
      const started = this.#deviceById.has(id)

      devices.push({
        id,
        publishAs: cfg.publishAs ?? id,
        role: cfg.coreRole ?? null,
        type: cfg.kind ?? null,
        bus: cfg.domain ?? null,

        enabled: runtimeState !== 'manualBlocked',
        started,
        runtimeState,
      })
    }

    return { devices }
  }

  block(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const inst = this.#deviceById.get(id)
    if (inst?.block) {
      try {
        inst.block()
      } catch (e) {
        this.#logger.error('device_block_failed', { deviceId: id, error: e?.message || String(e) })
      }
    }

    this.#setRuntimeState(id, 'manualBlocked', { reason })
    return { ok: true }
  }

  unblock(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const modes = Array.isArray(cfg?.modes) ? cfg.modes : []
    if (!modes.includes(this.#mode)) {
      this.#setRuntimeState(id, 'manualBlocked', { reason: 'mode_mismatch', mode: this.#mode })
      return { ok: false, error: 'MODE_MISMATCH' }
    }

    const inst = this.#deviceById.get(id)

    if (!inst) {
      // Create instance (still not creating protocols here)
      return this.#ensureStarted(cfg, { reason }) ? { ok: true } : { ok: false, error: 'START_FAILED' }
    }

    try {
      inst.unblock?.()
      this.#setRuntimeState(id, 'active', { phase: 'unblock', reason })
      return { ok: true }
    } catch (e) {
      this.#logger.error('device_unblock_failed', { deviceId: id, error: e?.message || String(e) })
      this.#setRuntimeState(id, 'degraded', { phase: 'unblock', reason, error: e?.message || String(e) })
      return { ok: false, error: 'START_FAILED' }
    }
  }

  inject(deviceId, raw) {
    const id = String(deviceId || '').trim()
    const inst = this.#deviceById.get(id)

    if (!inst?.inject) {
      return { ok: false, error: 'NOT_SUPPORTED' }
    }

    try {
      inst.inject(raw)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'INJECT_FAILED', message: e?.message || String(e) }
    }
  }

  #ensureStarted(cfg, detail = {}) {
    const id = cfg.id

    // Create new instance if missing
    let inst = this.#deviceById.get(id)
    if (!inst) {
      inst = makeDeviceInstance({
        logger: this.#logger,
        clock: this.#clock,
        buses: this.#buses,
        device: cfg,
        protocolFactory: this.#protocolFactory,
      })

      this.#deviceById.set(id, inst)
    }

    try {
      inst.start?.()
      this.#setRuntimeState(id, 'active', { phase: 'start', ...detail })
      return true
    } catch (e) {
      this.#logger.error('device_start_failed', { deviceId: id, error: e?.message || String(e) })
      this.#setRuntimeState(id, 'degraded', { phase: 'start', error: e?.message || String(e), ...detail })
      return false
    }
  }

  #setRuntimeState(deviceId, state, detail = {}) {
    this.#runtimeStateById.set(deviceId, state)

    const cfg = this.#deviceConfigById.get(deviceId)
    const publishAs = cfg?.publishAs ?? deviceId

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'deviceManager',
      payload: {
        deviceId,
        publishAs,
        state,
        detail,
      },
    })
  }
}

export default DeviceManager
