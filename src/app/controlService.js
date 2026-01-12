// src/app/controlService.js
export default function ControlService ({ buses, hw, logger }) {
  let injectEnabled = false

  /* concise internal helper */
  const getDriverId = (driver) => {
    if (typeof driver.getSensorId === 'function') {
      return driver.getSensorId()
    }

    return driver?.sensor?.id ?? driver?.id ?? null
  }

  const listDrivers = () => {
    const drivers = Array.isArray(hw?.drivers) ? hw.drivers : []

    return drivers.map((d) => ({
      id: getDriverId(d),
      role: typeof d.getRole === 'function' ? d.getRole() : null,
      type: typeof d.getType === 'function' ? d.getType() : null,
      bus: typeof d.getBus === 'function' ? d.getBus() : null,
      enabled: typeof d.isEnabled === 'function' ? d.isEnabled() : null,
      started: typeof d.isStarted === 'function' ? d.isStarted() : null,
    }))
  }

  const setInjectEnabled = ({ enabled }) => {
    injectEnabled = enabled === true
    logger.notice('inject_set', { enabled: injectEnabled })
    return { injectEnabled }
  }

  const injectEvent = ({ bus, type, payload, source }) => {
    if (!injectEnabled) {
      const err = new Error('inject_disabled')
      err.code = 'INJECT_DISABLED'
      throw err
    }

    const target = buses?.[bus]
    if (!target?.publish) {
      const err = new Error(`unknown_bus:${bus}`)
      err.code = 'BUS_NOT_FOUND'
      throw err
    }

    target.publish({
      type,
      ts: Date.now(),
      source: source ?? 'ws',
      payload: payload ?? {},
    })

    return { ok: true }
  }

  const findDriver = ({ sensorId }) => {
    const byId = hw?.driverBySensorId
    if (byId instanceof Map) {
      return byId.get(sensorId) ?? null
    }

    const drivers = Array.isArray(hw?.drivers) ? hw.drivers : []
    return drivers.find((d) => getDriverId(d) === sensorId) ?? null
  }

  const setDriverEnabled = async ({ sensorId, enabled }) => {
    const driver = findDriver({ sensorId })
    if (!driver) {
      const err = new Error(`unknown_driver:${sensorId}`)
      err.code = 'DRIVER_NOT_FOUND'
      throw err
    }

    if (typeof driver.setEnabled !== 'function') {
      const err = new Error(`driver_setEnabled_missing:${sensorId}`)
      err.code = 'NOT_SUPPORTED'
      throw err
    }

    driver.setEnabled(enabled === true)

    return {
      ok: true,
      sensorId,
      enabled: typeof driver.isEnabled === 'function' ? driver.isEnabled() : enabled === true
    }
  }

  const handleWsRequest = async ({ id, type, payload }) => {
    if (type === 'driver.list') {
      return {
        id,
        ok: true,
        type,
        payload: { drivers: listDrivers() }
      }
    }

    if (type === 'driver.enable') {
      const out = await setDriverEnabled({ sensorId: payload?.sensorId, enabled: true })
      return { id, ok: true, type, payload: out }
    }

    if (type === 'driver.disable') {
      const out = await setDriverEnabled({ sensorId: payload?.sensorId, enabled: false })
      return { id, ok: true, type, payload: out }
    }

    return null
  }

  return {
    injectEnable: async () => setInjectEnabled({ enabled: true }),
    injectDisable: async () => setInjectEnabled({ enabled: false }),
    injectEvent: async (payload) => injectEvent(payload),

    handleWsRequest,
  }
}
