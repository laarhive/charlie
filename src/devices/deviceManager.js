// src/devices/deviceManager.js
import eventTypes from '../core/eventTypes.js'
import makeHwDrivers, { disposeSignals } from './legacy/hwDrivers.js'

import ButtonEdgeDevice from './kinds/buttonEdge/buttonEdgeDevice.js'
import VirtualBinaryInput from './protocols/virt/virtualBinaryInput.js'
import GpioBinaryInputGpiod from './protocols/gpio/gpioBinarySignalGpiod.js'

export class DeviceManager {
  #logger
  #mainBus
  #clock
  #mode
  #config
  #buses

  #legacy
  #signals

  #devices
  #deviceById

  #runtimeStateById

  constructor({ logger, mainBus, buses, clock, config, mode }) {
    this.#logger = logger
    this.#mainBus = mainBus
    this.#buses = buses
    this.#clock = clock
    this.#config = config
    this.#mode = mode

    this.#legacy = null
    this.#signals = null

    this.#devices = []
    this.#deviceById = new Map()

    this.#runtimeStateById = new Map()
  }

  start() {
    if (this.#devices.length > 0 || this.#legacy) {
      return
    }

    const sensors = Array.isArray(this.#config?.sensors) ? this.#config.sensors : []

    const isActiveInModeNew = (s) => {
      const modes = Array.isArray(s?.modes) ? s.modes : []
      const state = s?.state ?? 'active'
      return modes.includes(this.#mode) && state === 'active'
    }

    const isManualBlockedNew = (s) => (s?.state ?? 'active') === 'manualBlocked'

    const isActiveLegacy = (s) => {
      if (s?.enabled === false) {
        return false
      }

      const modes = Array.isArray(s?.modes) ? s.modes : []
      return modes.includes(this.#mode)
    }

    // 1) New devices (only those with kind)
    for (const s of sensors) {
      if (!s?.id || !s?.kind) {
        continue
      }

      const deviceId = s.id

      if (isManualBlockedNew(s)) {
        this.#registerDevice(deviceId, null, 'manualBlocked', { phase: 'config' })
        continue
      }

      if (!isActiveInModeNew(s)) {
        continue
      }

      try {
        const dev = this.#makeNewDevice(s)
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

    // 2) Legacy (everything else)
    const legacy = makeHwDrivers({
      logger: this.#logger,
      buses: this.#buses,
      clock: this.#clock,
      config: {
        ...this.#config,
        sensors: sensors.filter((s) => !s?.kind).filter((s) => isActiveLegacy(s)),
      },
      mode: this.#mode,
    })

    this.#legacy = legacy
    this.#signals = legacy.signals

    for (const d of legacy.drivers) {
      const id = d.getSensorId()

      try {
        d.start()
        this.#setRuntimeState(id, 'active', { phase: 'start', legacy: true })
      } catch (e) {
        this.#logger.error('device_start_failed', {
          deviceId: id,
          error: e?.message || String(e),
        })

        this.#setRuntimeState(id, 'degraded', {
          phase: 'start',
          legacy: true,
          error: e?.message || String(e),
        })
      }
    }

    this.#logger.notice('device_manager_started', {
      mode: this.#mode,
      devicesNew: this.#devices.length,
      devicesLegacy: legacy.drivers.length,
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
    this.#runtimeStateById.clear()

    if (this.#legacy) {
      for (const d of this.#legacy.drivers) {
        try {
          d.dispose()
        } catch (e) {
          this.#logger.error('device_dispose_failed', {
            deviceId: d.getSensorId(),
            error: e?.message || String(e),
          })
        }
      }

      disposeSignals(this.#legacy.signals)
      this.#legacy = null
      this.#signals = null
    }

    this.#logger.notice('device_manager_disposed', {})
  }

  getSignals() {
    return this.#signals
  }

  list() {
    const devices = []

    // New devices
    for (const d of this.#devices) {
      const id = d.getId()
      const runtimeState = this.#runtimeStateById.get(id) || 'unknown'

      devices.push({
        id,
        publishAs: d.getPublishAs?.() ?? id,
        role: d.getRole?.() ?? null,
        type: d.getKind?.() ?? null,
        bus: d.getDomain?.() ?? null,

        enabled: runtimeState !== 'manualBlocked',
        started: true,
        runtimeState,
      })
    }

    // Legacy devices
    const legacyDrivers = Array.isArray(this.#legacy?.drivers) ? this.#legacy.drivers : []
    for (const d of legacyDrivers) {
      const id = d.getSensorId()
      const runtimeState = this.#runtimeStateById.get(id) || 'unknown'

      devices.push({
        id,
        publishAs: this.#getPublishAsLegacy(id),
        role: d.getRole?.() ?? null,
        type: d.getType?.() ?? null,
        bus: d.getBus?.() ?? null,

        enabled: d.isEnabled?.() ?? null,
        started: d.isStarted?.() ?? null,
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

    const d = this.#deviceById.get(id)
    if (d) {
      d.block?.()
      this.#setRuntimeState(id, 'manualBlocked', { reason })
      return { ok: true }
    }

    const legacy = this.#legacy?.driverBySensorId
    const ld = legacy instanceof Map ? legacy.get(id) : null
    if (ld?.setEnabled) {
      ld.setEnabled(false)
      this.#setRuntimeState(id, 'manualBlocked', { reason, legacy: true })
      return { ok: true }
    }

    return { ok: false, error: 'DEVICE_NOT_FOUND' }
  }

  unblock(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    if (!id) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const d = this.#deviceById.get(id)
    if (d) {
      d.unblock?.()
      this.#setRuntimeState(id, 'active', { reason })
      return { ok: true }
    }

    const legacy = this.#legacy?.driverBySensorId
    const ld = legacy instanceof Map ? legacy.get(id) : null
    if (ld?.setEnabled) {
      ld.setEnabled(true)
      this.#setRuntimeState(id, 'active', { reason, legacy: true })
      return { ok: true }
    }

    return { ok: false, error: 'DEVICE_NOT_FOUND' }
  }

  inject(deviceId, command) {
    const id = String(deviceId || '').trim()
    if (!id) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    const d = this.#deviceById.get(id)
    if (d?.inject) {
      try {
        d.inject(command)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: 'INJECT_FAILED', message: e?.message || String(e) }
      }
    }

    return { ok: false, error: 'NOT_SUPPORTED' }
  }

  #registerDevice(deviceId, device, runtimeState, detail) {
    if (device) {
      this.#devices.push(device)
      this.#deviceById.set(deviceId, device)
    }

    this.#setRuntimeState(deviceId, runtimeState, detail)
  }

  #setRuntimeState(deviceId, state, detail = {}) {
    this.#runtimeStateById.set(deviceId, state)

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'deviceManager',
      payload: {
        deviceId,
        publishAs: this.#getPublishAs(deviceId),
        state,
        detail,
      },
    })
  }

  #getPublishAs(deviceId) {
    const sensors = Array.isArray(this.#config?.sensors) ? this.#config.sensors : []
    const s = sensors.find((x) => x?.id === deviceId)
    return s?.publishAs ?? deviceId
  }

  #getPublishAsLegacy(deviceId) {
    return this.#getPublishAs(deviceId)
  }

  #makeNewDevice(device) {
    if (device.kind === 'buttonEdge') {
      const input = this.#makeBinaryInput(device)

      return new ButtonEdgeDevice({
        logger: this.#logger,
        clock: this.#clock,
        buttonBus: this.#buses.button,
        device,
        input,
      })
    }

    throw new Error(`unsupported_device_kind:${device.kind}`)
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
