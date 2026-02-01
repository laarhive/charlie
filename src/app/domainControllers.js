// src/app/domainControllers.js
import BinaryPresenceController from '../domains/presence/binaryPresenceController.js'
import HitVibrationController from '../domains/vibration/hitVibrationController.js'
import EdgeButtonController from '../domains/button/edgeButtonController.js'
import LedController from '../domains/led/ledController.js'

/**
 * Builds domain controllers that consume domain buses and publish to main bus.
 *
 * @example
 * const controllers = makeDomainControllers({ logger, buses, clock, config })
 */
export const makeDomainControllers = function makeDomainControllers({ logger, buses, clock, config }) {
  const sensors = Array.isArray(config?.sensors) ? config.sensors : []

  const presenceSensors = sensors.filter((s) => s?.role === 'presence')
  const vibrationSensors = sensors.filter((s) => s?.role === 'vibration')
  const buttonSensors = sensors.filter((s) => s?.role === 'button')
  const ledDevices = sensors.filter((s) => s?.role === 'led')

  const presenceController = new BinaryPresenceController({
    logger,
    presenceBus: buses.presence,
    mainBus: buses.main,
    clock,
    controllerId: 'presenceController',
    sensors: presenceSensors,
  })

  const vibrationController = new HitVibrationController({
    logger,
    vibrationBus: buses.vibration,
    mainBus: buses.main,
    clock,
    controllerId: 'vibrationController',
    sensors: vibrationSensors,
  })

  const pushButtonController = new EdgeButtonController({
    logger,
    buttonBus: buses.button,
    mainBus: buses.main,
    clock,
    controllerId: 'pushButtonController',
    sensors: buttonSensors,
  })


  const ledController = new LedController({
    logger,
    ledBus: buses.led,
    mainBus: buses.main,
    clock,
    controllerId: 'ledController',
    leds: ledDevices,
  })

  return [presenceController, vibrationController, pushButtonController, ledController]
}

export const startAll = function startAll(items) {
  for (const x of items) {
    x.start()
  }
}

export const disposeAll = function disposeAll(items) {
  for (const x of items) {
    x.dispose()
  }
}

export default makeDomainControllers
