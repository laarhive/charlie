// src/devices/kinds/index.js
import ButtonEdgeDevice from './buttonEdge/buttonEdgeDevice.js'
import GpioWatchdogLoopbackDevice from './gpioWatchdogLoopback/gpioWatchdogLoopbackDevice.js'

export const makeDeviceInstance = function makeDeviceInstance({ logger, clock, buses, device, protocolFactory }) {
  const domain = String(device?.domain || '').trim()
  if (!domain) {
    throw new Error('device_requires_domain')
  }

  const domainBus = buses?.[domain]
  if (!domainBus?.publish) {
    throw new Error(`unknown_domain_bus:${domain}`)
  }

  const mainBus = buses?.main
  if (!mainBus?.publish) {
    throw new Error('buses.main_missing')
  }

  const kind = String(device?.kind || '').trim()

  if (kind === 'buttonEdge') {
    return new ButtonEdgeDevice({
      logger,
      clock,
      domainBus,
      mainBus,
      device,
      protocolFactory,
    })
  }

  if (kind === 'gpioWatchdogLoopback') {
    return new GpioWatchdogLoopbackDevice({
      logger,
      clock,
      buses,
      device,
    })
  }

  throw new Error(`unsupported_device_kind:${kind || 'missing'}`)
}

export default makeDeviceInstance
