// src/devices/kinds/index.js
import { deviceError } from '../deviceError.js'
import ButtonEdgeDevice from './buttonEdge/buttonEdgeDevice.js'
import GpioWatchdogLoopbackDevice from './gpioWatchdogLoopback/gpioWatchdogLoopbackDevice.js'
import Ld2450RadarDevice from './ld2450Radar/ld2450RadarDevice.js'
import Ld2410RadarDevice from './ld2410Radar/ld2410RadarDevice.js'
import Ws2812LedDevice from './ws2812Led/ws2812LedDevice.js'

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

  if (kind === 'ld2450Radar') {
    return new Ld2450RadarDevice({
      logger,
      clock,
      domainBus,
      mainBus,
      device,
      protocolFactory,
    })
  }

  if (kind === 'ld2410Radar') {
    return new Ld2410RadarDevice({
      logger,
      clock,
      domainBus,
      mainBus,
      device,
      protocolFactory,
    })
  }

  if (kind === 'ws2812Led') {
    return new Ws2812LedDevice({
      logger,
      clock,
      domainBus,
      mainBus,
      device,
      protocolFactory,
    })
  }

  throw deviceError('UNSUPPORTED_DEVICE_KIND', `unsupported_device_kind:${kind || 'missing'}`, { kind })
}

export default makeDeviceInstance
