// src/app/domainControllers.js
import PresenceController from '../domains/presence/PresenceController.js'
import HitVibrationController from '../domains/vibration/hitVibrationController.js'
import EdgeButtonController from '../domains/button/edgeButtonController.js'
import LedController from '../domains/led/ledController.js'

const toRuntimeDevices = function toRuntimeDevices(devices) {
  const list = Array.isArray(devices) ? devices : []

  return list.map((d) => {
    const out = { ...d }

    if (out.enabled === undefined) {
      out.enabled = true
    }

    return out
  })
}

export const makeDomainControllers = function makeDomainControllers({ logger, buses, clock, config }) {
  const devices = toRuntimeDevices(config?.devices)
  const controllers = config?.controllers || {}

  const byDomain = (domain) => devices.filter((d) => d?.domain === domain)

  const out = []

  {
    const controller = controllers?.presence || {}
    out.push(new PresenceController({
      logger,
      presenceInternalBus: buses.presenceInternal,
      presenceBus: buses.presence,
      mainBus: buses.main,
      clock,
      controllerId: 'presenceController',
      controller,
      devices: byDomain('presence'),
    }))
  }

  {
    const controller = controllers?.vibration || {}
    out.push(new HitVibrationController({
      logger,
      vibrationBus: buses.vibration,
      mainBus: buses.main,
      clock,
      controllerId: 'vibrationController',
      controller,
      devices: byDomain('vibration'),
    }))
  }

  {
    const controller = controllers?.button || {}
    out.push(new EdgeButtonController({
      logger,
      buttonBus: buses.button,
      mainBus: buses.main,
      clock,
      controllerId: 'pushButtonController',
      controller,
      devices: byDomain('button'),
    }))
  }

  {
    const controller = controllers?.led || {}
    out.push(new LedController({
      logger,
      ledBus: buses.led,
      mainBus: buses.main,
      clock,
      controllerId: 'ledController',
      controller,
      devices: byDomain('led'),
    }))
  }

  return out
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
