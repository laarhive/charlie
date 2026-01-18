// src/devices/kinds/index.js
import ButtonEdgeDevice from './buttonEdge/buttonEdgeDevice.js'
import GpioWatchdogLoopbackDevice from './gpioWatchdogLoopback/gpioWatchdogLoopbackDevice.js'
import { deviceError } from '../deviceError.js'

export const makeDeviceInstance = function makeDeviceInstance({ logger, clock, buses, device, protocolFactory }) {
  const domain = String(device?.domain || '').trim()
  if (!domain) {
    throw deviceError('DEVICE_REQUIRES_DOMAIN', 'device_requires_domain')
  }

  const domainBus = buses?.[domain]
  if (!domainBus?.publish) {
    throw deviceError('UNKNOWN_DOMAIN_BUS', `unknown_domain_bus:${domain}`, { domain })
  }

  const mainBus = buses?.main
  if (!mainBus?.publish) {
    throw deviceError('MAIN_BUS_MISSING', 'buses.main_missing')
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

  throw deviceError('UNSUPPORTED_DEVICE_KIND', `unsupported_device_kind:${kind || 'missing'}`, { kind })
}

export default makeDeviceInstance
