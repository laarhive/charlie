// src/app/controlService.js
export default function ControlService ({ buses, deviceManager, logger }) {
  let injectEnabled = false

  const listDrivers = () => {
    const out = deviceManager?.list?.()
    const devices = Array.isArray(out?.devices) ? out.devices : []

    return devices.map((d) => ({
      id: d.id,
      role: d.role ?? null,
      type: d.type ?? null,
      bus: d.bus ?? null,
      enabled: d.enabled ?? null,
      started: d.started ?? null,
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

  const setDriverEnabled = async ({ sensorId, enabled }) => {
    if (!deviceManager) {
      const err = new Error('device_manager_missing')
      err.code = 'INTERNAL_ERROR'
      throw err
    }

    const id = String(sensorId || '').trim()
    if (!id) {
      const err = new Error('missing_sensorId')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const out = enabled === true
      ? deviceManager.unblock(id)
      : deviceManager.block(id)

    if (!out?.ok) {
      const code = out?.error === 'DEVICE_NOT_FOUND' ? 'DRIVER_NOT_FOUND' : 'INTERNAL_ERROR'
      const err = new Error(`driver_toggle_failed:${id}`)
      err.code = code
      throw err
    }

    const list = deviceManager.list()
    const devices = Array.isArray(list?.devices) ? list.devices : []
    const found = devices.find((d) => d?.id === id) ?? null

    return {
      ok: true,
      id,
      enabled: found?.enabled ?? enabled === true,
    }
  }

  const handleWsRequest = async ({ id, type, payload }) => {
    if (type === 'driver.list') {
      return {
        id,
        ok: true,
        type,
        payload: { drivers: listDrivers() },
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

  const getSnapshot = () => ({
    injectEnabled,
  })

  return {
    getSnapshot,

    injectEnable: async () => setInjectEnabled({ enabled: true }),
    injectDisable: async () => setInjectEnabled({ enabled: false }),
    injectEvent: async (payload) => injectEvent(payload),

    handleWsRequest,
  }
}
