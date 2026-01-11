// src/app/hwDrivers.js
import Ld2410Driver from '../hw/presence/ld2410Driver.js'
import VirtualBinarySignal from '../hw/signal/virtualBinarySignal.js'

/**
 * Builds HW drivers. In virt mode these are backed by VirtualBinarySignal.
 *
 * Returns:
 * - drivers: array of driver instances
 * - driverBySensorId: Map(sensorId -> driver)
 * - signals: { presence: Map(sensorId -> VirtualBinarySignal) }
 *
 * @example
 * const hw = makeHwDrivers({ logger, buses, clock, config })
 */
export const makeHwDrivers = function makeHwDrivers({ logger, buses, clock, config }) {
  const sensors = Array.isArray(config?.sensors) ? config.sensors : []

  const presenceSignals = new Map()
  const drivers = []
  const driverBySensorId = new Map()

  for (const sensor of sensors) {
    if (!sensor?.enabled) {
      continue
    }

    if (sensor.role === 'presence' && sensor.type === 'ld2410') {
      const signal = new VirtualBinarySignal(false)
      presenceSignals.set(sensor.id, signal)

      const driver = new Ld2410Driver({
        logger,
        presenceBus: buses.presence,
        clock,
        sensor,
        signal,
      })

      drivers.push(driver)
      driverBySensorId.set(sensor.id, driver)
    }
  }

  return {
    drivers,
    driverBySensorId,
    signals: {
      presence: presenceSignals,
    },
  }
}

export const disposeSignals = function disposeSignals(signals) {
  for (const m of Object.values(signals || {})) {
    if (!(m instanceof Map)) {
      continue
    }

    for (const s of m.values()) {
      if (s && typeof s.dispose === 'function') {
        s.dispose()
      }
    }

    m.clear()
  }
}

export default makeHwDrivers
