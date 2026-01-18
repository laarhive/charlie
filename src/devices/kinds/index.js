// src/devices/kinds/index.js
import ButtonEdgeDevice from './buttonEdge/buttonEdgeDevice.js'

/**
 * Device kind registry.
 *
 * DeviceManager depends only on this registry, not on individual kinds.
 * Add a new kind by extending this file, without touching DeviceManager.
 *
 * @example
 * const inst = makeDeviceInstance({ logger, clock, buses, device, protocolFactory })
 */
export const makeDeviceInstance = function makeDeviceInstance({ logger, clock, buses, device, protocolFactory }) {
  const domain = String(device?.domain || '').trim()
  if (!domain) {
    throw new Error('device_requires_domain')
  }

  const domainBus = buses?.[domain]
  if (!domainBus?.publish) {
    throw new Error(`unknown_domain_bus:${domain}`)
  }

  const kind = String(device?.kind || '').trim()

  if (kind === 'buttonEdge') {
    return new ButtonEdgeDevice({
      logger,
      clock,
      domainBus,
      device,
      protocolFactory,
    })
  }

  throw new Error(`unsupported_device_kind:${kind || 'missing'}`)
}

export default makeDeviceInstance
