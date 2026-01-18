// src/devices/deviceManager.js
import eventTypes from '../core/eventTypes.js'
import makeHwDrivers, { disposeSignals } from '../app/hwDrivers.js'

export class DeviceManager {
  #logger
  #mainBus
  #clock
  #mode
  #config
  #buses

  #drivers
  #driverByDeviceId
  #signals

  #runtimeStateByDeviceId

  constructor({ logger, mainBus, buses, clock, config, mode }) {
    this.#logger = logger
    this.#mainBus = mainBus
    this.#buses = buses
    this.#clock = clock
    this.#config = config
    this.#mode = mode

    this.#drivers = []
    this.#driverByDeviceId = new Map()
    this.#signals = null

    this.#runtimeStateByDeviceId = new Map()
  }

  start() {
    if (this.#drivers.length > 0 || this.#signals) {
      return
    }

    const built = makeHwDrivers({
      logger: this.#logger,
      buses: this.#buses,
      clock: this.#clock,
      config: this.#config,
      mode: this.#mode,
    })

    this.#drivers = built.drivers
    this.#driverByDeviceId = built.driverBySensorId
    this.#signals = built.signals

    for (const d of this.#drivers) {
      const deviceId = d.getSensorId()

      try {
        d.start()
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
      devices: this.#drivers.length,
    })
  }

  dispose() {
    for (const d of this.#drivers) {
      try {
        d.dispose()
      } catch (e) {
        this.#logger.error('device_dispose_failed', {
          deviceId: d.getSensorId(),
          error: e?.message || String(e),
        })
      }
    }

    this.#drivers = []
    this.#driverByDeviceId.clear()
    this.#runtimeStateByDeviceId.clear()

    if (this.#signals) {
      disposeSignals(this.#signals)
      this.#signals = null
    }

    this.#logger.notice('device_manager_disposed', {})
  }

  list() {
    const devices = []

    for (const d of this.#drivers) {
      const deviceId = d.getSensorId()
      const runtimeState = this.#runtimeStateByDeviceId.get(deviceId) || 'unknown'

      devices.push({
        id: deviceId,
        publishAs: this.#getPublishAs(deviceId),
        role: d.getRole?.() || null,
        type: d.getType?.() || null,
        bus: d.getBus?.() || null,

        enabled: d.isEnabled?.() ?? null,
        started: d.isStarted?.() ?? null,
        runtimeState,
      })
    }

    return { devices }
  }

  block(deviceId, reason = 'manual') {
    const d = this.#driverByDeviceId.get(deviceId)
    if (!d) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    if (d.setEnabled) {
      d.setEnabled(false)
    }

    this.#setRuntimeState(deviceId, 'manualBlocked', { reason })
    return { ok: true }
  }

  unblock(deviceId, reason = 'manual') {
    const d = this.#driverByDeviceId.get(deviceId)
    if (!d) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    if (d.setEnabled) {
      d.setEnabled(true)
    }

    this.#setRuntimeState(deviceId, 'active', { reason })
    return { ok: true }
  }

  inject(deviceId, command) {
    const d = this.#driverByDeviceId.get(deviceId)
    if (!d) {
      return { ok: false, error: 'DEVICE_NOT_FOUND' }
    }

    if (!d.inject) {
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
    this.#runtimeStateByDeviceId.set(deviceId, state)

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
}

export default DeviceManager
