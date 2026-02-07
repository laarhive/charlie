// src/app/controlService.js
import { makeStreamKey } from '../core/eventBus.js'
import eventTypes from '../core/eventTypes.js'
import { busIds } from './buses.js'

export default function ControlService ({ buses, deviceManager, logger }) {
  let injectEnabled = false

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
      streamKey: makeStreamKey({
        who: 'controlService.injectEvent',
        what: type,
        where: bus,
      }),
      payload: payload ?? {},
    })

    return { ok: true }
  }

  const ensureDeviceManager = () => {
    if (!deviceManager) {
      const err = new Error('device_manager_missing')
      err.code = 'INTERNAL_ERROR'
      throw err
    }
  }

  const listDevices = () => {
    ensureDeviceManager()

    const out = deviceManager.list()
    const devices = Array.isArray(out?.devices) ? out.devices : []
    return { devices }
  }

  const blockDevice = ({ deviceId }) => {
    ensureDeviceManager()

    const id = String(deviceId || '').trim()
    if (!id) {
      const err = new Error('missing_deviceId')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const out = deviceManager.block(id)

    if (!out?.ok) {
      const err = new Error(`device_block_failed:${id}`)
      err.code = out?.error === 'DEVICE_NOT_FOUND' ? 'DEVICE_NOT_FOUND' : 'INTERNAL_ERROR'
      throw err
    }

    return { ok: true, id }
  }

  const unblockDevice = ({ deviceId }) => {
    ensureDeviceManager()

    const id = String(deviceId || '').trim()
    if (!id) {
      const err = new Error('missing_deviceId')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const out = deviceManager.unblock(id)

    if (!out?.ok) {
      const err = new Error(`device_unblock_failed:${id}`)
      err.code = out?.error || 'INTERNAL_ERROR'
      throw err
    }

    return { ok: true, id }
  }

  const injectDevice = ({ deviceId, payload }) => {
    ensureDeviceManager()

    const id = String(deviceId || '').trim()
    if (!id) {
      const err = new Error('missing_deviceId')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const raw = payload
    if (raw === undefined || raw === null || String(raw).trim().length === 0) {
      const err = new Error('missing_payload')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const out = deviceManager.inject(id, raw)
    if (!out?.ok) {
      const err = new Error(`device_inject_failed:${id}`)
      err.code = out?.error || 'INTERNAL_ERROR'
      err.message = out?.message || err.message
      throw err
    }

    return { ok: true, id }
  }

  const handleWsRequest = async ({ id, type, payload }) => {
    if (type === 'device.list') {
      return {
        id,
        ok: true,
        type,
        payload: listDevices(),
      }
    }

    if (type === 'device.block') {
      const out = blockDevice({ deviceId: payload?.deviceId })
      return { id, ok: true, type, payload: out }
    }

    if (type === 'device.unblock') {
      const out = unblockDevice({ deviceId: payload?.deviceId })
      return { id, ok: true, type, payload: out }
    }

    if (type === 'device.inject') {
      const out = injectDevice({ deviceId: payload?.deviceId, payload: payload?.payload })
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
