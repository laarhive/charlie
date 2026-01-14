// src/app/hwDrivers.js
import Ld2410Driver from '../hw/presence/ld2410Driver.js'
import Sw420Driver from '../hw/vibration/sw420Driver.js'
import GpioButtonDriver from '../hw/button/gpioButtonDriver.js'

import VirtualBinarySignal from '../hw/signal/virtualBinarySignal.js'
import GpioBinarySignalGpiod from '../hw/signal/gpioBinarySignalGpiod.js'

export const makeHwDrivers = function makeHwDrivers({ logger, buses, clock, config, mode }) {
  const sensors = Array.isArray(config?.sensors) ? config.sensors : []

  const drivers = []
  const driverBySensorId = new Map()

  const signals = {
    presence: new Map(),
    vibration: new Map(),
    button: new Map(),
  }

  const makeSignal = (sensor) => {
    if (mode === 'virt') {
      return new VirtualBinarySignal(false)
    }

    if (mode !== 'hw') {
      throw new Error(`Unknown mode: ${mode}`)
    }

    if (process.platform !== 'linux') {
      throw new Error('HW mode requires Linux (libgpiod)')
    }

    const hw = sensor?.hw || {}

    return new GpioBinarySignalGpiod({
      chip: hw.chip,
      line: hw.line,
      activeHigh: hw.activeHigh !== false,
    })
  }

  for (const sensor of sensors) {
    if (!sensor?.enabled) {
      continue
    }

    if (sensor.role === 'presence' && sensor.type === 'ld2410') {
      const signal = makeSignal(sensor)
      signals.presence.set(sensor.id, signal)

      const driver = new Ld2410Driver({
        logger,
        presenceBus: buses.presence,
        clock,
        sensor,
        signal,
      })

      drivers.push(driver)
      driverBySensorId.set(sensor.id, driver)
      continue
    }

    if (sensor.role === 'vibration' && sensor.type === 'sw420') {
      const signal = makeSignal(sensor)
      signals.vibration.set(sensor.id, signal)

      const driver = new Sw420Driver({
        logger,
        vibrationBus: buses.vibration,
        clock,
        sensor,
        signal,
      })

      drivers.push(driver)
      driverBySensorId.set(sensor.id, driver)
      continue
    }

    if (sensor.role === 'button' && sensor.type === 'gpioButton') {
      const signal = makeSignal(sensor)
      signals.button.set(sensor.id, signal)

      const driver = new GpioButtonDriver({
        logger,
        buttonBus: buses.button,
        clock,
        sensor,
        signal,
      })

      drivers.push(driver)
      driverBySensorId.set(sensor.id, driver)
      continue
    }
  }

  return {
    drivers,
    driverBySensorId,
    signals,
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
