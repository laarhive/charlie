// src/devices/deviceManager.js
import eventTypes from '../core/eventTypes.js'

import ButtonEdgeDevice from './kinds/buttonEdge/buttonEdgeDevice.js'
import VirtualBinaryInput from './protocols/virt/virtualBinaryInput.js'
import GpioBinaryInputGpiod from './protocols/gpio/gpioBinaryInputGpiod.js'

export class DeviceManager {
  #logger
  #mainBus
  #clock
  #mode
  #config
  #buses

  #devices
  #deviceById

  #deviceConfigById
  #runtimeStateById

  constructor({ logger, mainBus, buses, clock, config, mode }) {
    this.#logger = logger
    this.#mainBus = mainBus
    this.#buses = buses
    this.#clock = clock
    this.#config = config
    this.#mode = mode

    this.#devices = []
    this.#deviceById = new Map()

    this.#deviceConfigById = new Map()
    this.#runtimeStateById = new Map()
  }

  start() {
    if (this.#devices.length > 0) {
      return
    }

    const devices = Array.isArray(this.#config?.devices) ? this.#config.devices : []

    for (const d of devices) {
      if (!d?.id) {
        continue
      }

      this.#deviceConfigById.set(d.id, d)
    }

    for (const cfg of devices) {
      const deviceId = cfg?.id
      if (!deviceId) {
        continue
      }

      const configuredState = cfg?.state ?? 'active'
      if (configuredState === 'manualBlocked') {
        this.#setRuntimeState(deviceId, 'manualBlocked', { phase: 'config' })
        continue
      }

      const modes = Array.isArray(cfg?.modes) ? cfg.modes : []
      if (!modes.includes(this.#mode)) {
        continue
      }

      try {
        const dev = this.#makeDevice(cfg)
        this.#devices.push(dev)
        this.#deviceById.set(deviceId, dev)

        dev.start()
        this.#setRuntimeState(deviceId, 'active', { phase: 'start' })
      } catch (e) {
        this.#logger.error('device_start_failed', {
          deviceId,
          error: e?.message || String(e),
        })

        this.#setRuntimeState(deviceId, 'degraded', {
          phase: 'start',
          error: e?.message || String(e),
        })
      }
    }

    this.#logger.notice('device_manager_started', {
      mode: this.#mode,
      devices: this.#devices.length,
    })
  }

  dispose() {
    for (const d of this.#devices) {
      try {
        d.dispose()
      } catch (e) {
        this.#logger.error('device_dispose_failed', {
          deviceId: d.getId?.() || null,
          error: e?.message || String(e),
        })
      }
    }

    this.#devices = []
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

      const kind = cfg.kind ?? null
      const role = cfg.role ?? null
      const domain = cfg.domain ?? null

      const started = this.#deviceById.has(id)
      const enabled = runtimeState !== 'manualBlocked'

      devices.push({
        id,
        publishAs: cfg.publishAs ?? id,
        role,
        type: kind,
        bus: domain,

        enabled,
        started,
        runtimeState,
      })
    }

    return { devices }
  }

  block(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    if (!id) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const d = this.#deviceById.get(id)
    if (d?.block) {
      d.block()
    }

    this.#setRuntimeState(id, 'manualBlocked', { reason })
    return { ok: true }
  }

  unblock(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    if (!id) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const modes = Array.isArray(cfg?.modes) ? cfg.modes : []
    if (!modes.includes(this.#mode)) {
      this.#setRuntimeState(id, 'manualBlocked', { reason: 'mode_mismatch', mode: this.#mode })
      return { ok: false, error: 'MODE_MISMATCH' }
    }

    const d = this.#deviceById.get(id)
    if (d?.unblock) {
      d.unblock()
      this.#setRuntimeState(id, 'active', { reason })
      return { ok: true }
    }

    this.#setRuntimeState(id, 'active', { reason, note: 'not_started_v1' })
    return { ok: true }
  }

  inject(deviceId, command) {
    const id = String(deviceId || '').trim()
    if (!id) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const d = this.#deviceById.get(id)
    if (!d?.inject) {
      return { ok: false, error: 'NOT_SUPPORTED' }
    }

    try {
      d.inject(command)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'INJECT_FAILED', message: e?.message || String(e) }
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

  #makeDevice(cfg) {
    const domain = String(cfg?.domain || '').trim()
    if (!domain) {
      throw new Error('device_requires_domain')
    }

    const domainBus = this.#buses?.[domain]
    if (!domainBus?.publish) {
      throw new Error(`unknown_domain_bus:${domain}`)
    }

    if (cfg.kind === 'buttonEdge') {
      const input = this.#makeBinaryInput(cfg)

      return new ButtonEdgeDevice({
        logger: this.#logger,
        clock: this.#clock,
        domainBus,
        device: cfg,
        input,
      })
    }

    throw new Error(`unsupported_device_kind:${cfg.kind}`)
  }

  #makeBinaryInput(device) {
    const p = device?.protocol || {}
    const t = String(p?.type || '').trim()

    if (t === 'virt') {
      return new VirtualBinaryInput(p?.initial === true)
    }

    if (t === 'gpio') {
      const chip = p?.chip ?? this.#config?.gpio?.chip
      const line = p?.line
      const activeHigh = p?.activeHigh !== false

      return new GpioBinaryInputGpiod({ chip, line, activeHigh })
    }

    throw new Error(`unsupported_protocol_type:${t || 'missing'}`)
  }
}

export default DeviceManager
