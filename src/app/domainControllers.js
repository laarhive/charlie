// src/app/domainControllers.js
import BinaryPresenceController from '../domain/presence/binaryPresenceController.js'
import HitVibrationController from '../domain/vibration/hitVibrationController.js'
import EdgeButtonController from '../domain/button/edgeButtonController.js'

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

  return [presenceController, vibrationController, pushButtonController]
}

/**
 * Starts all controllers.
 *
 * @example
 * startAll(controllers)
 */
export const startAll = function startAll(items) {
  for (const x of items) {
    x.start()
  }
}

/**
 * Disposes all controllers/drivers.
 *
 * @example
 * disposeAll(controllers)
 */
export const disposeAll = function disposeAll(items) {
  for (const x of items) {
    x.dispose()
  }
}

export default makeDomainControllers
