// src/devices/deviceManager.js
import eventTypes from '../core/eventTypes.js'
import ProtocolFactory from './protocols/protocolFactory.js'
import makeDeviceInstance from './kinds/index.js'
import UsbInventory from './usbInventory.js'
import deviceErrorCodes from './deviceErrorCodes.js'
import { makeStreamKey } from '../core/eventBus.js'
import { busIds } from '../app/buses.js'

export class DeviceManager {
  #logger
  #mainBus
  #buses
  #clock
  #config

  #protocolFactory
  #usbInventory
  #usbEventSeq

  #deviceConfigById
  #deviceById
  #stateById

  #unsubMain

  #blockTokenSeq
  #blockTokensByDeviceId
  #blockedDeviceIdsByToken

  constructor({ logger, mainBus, buses, clock, config }) {
    this.#logger = logger
    this.#mainBus = mainBus
    this.#buses = buses
    this.#clock = clock
    this.#config = config

    this.#protocolFactory = new ProtocolFactory({ logger, clock, config })
    this.#usbInventory = new UsbInventory({ logger, clock, config })
    this.#usbEventSeq = 0

    this.#deviceConfigById = new Map()
    this.#deviceById = new Map()
    this.#stateById = new Map()

    this.#unsubMain = null

    this.#blockTokenSeq = 0
    this.#blockTokensByDeviceId = new Map()
    this.#blockedDeviceIdsByToken = new Map()
  }

  get streamKeyWho() { return 'deviceManager' }

  start() {
    const devices = Array.isArray(this.#config?.devices) ? this.#config.devices : []

    for (const cfg of devices) {
      if (!cfg?.id) continue
      this.#deviceConfigById.set(cfg.id, cfg)
    }

    this.#usbInventory.start()

    this.#usbInventory.on('attached', ({ usbId, endpoints }) => {
      this.#handleUsbAttached({ usbId, endpoints })
    })

    this.#usbInventory.on('detached', ({ usbId }) => {
      this.#handleUsbDetached({ usbId })
    })

    if (!this.#unsubMain) {
      this.#unsubMain = this.#mainBus.subscribe((evt) => {
        if (evt?.type !== eventTypes.system.hardware) return

        const p = evt?.payload || {}

        if (p?.subsystem === 'usb') {
          return
        }

        const id = p.deviceId
        const state = p.state

        if (!id || !state) return
        if (!this.#deviceConfigById.has(id)) return

        this.#stateById.set(id, state)
      })
    }

    for (const cfg of this.#deviceConfigById.values()) {
      const id = cfg.id

      const configuredState = cfg?.state ?? 'active'
      if (configuredState === 'manualBlocked') {
        this.#setState(id, 'manualBlocked', { phase: 'config' })
        continue
      }

      this.#ensureStarted(cfg, { reason: 'startup' })
    }
  }

  dispose() {
    if (this.#unsubMain) {
      this.#unsubMain()
      this.#unsubMain = null
    }

    this.#usbInventory.dispose()

    for (const [id, d] of this.#deviceById.entries()) {
      try {
        d.dispose()
      } catch (e) {
        this.#logger.error('device_dispose_failed', { deviceId: id, error: e?.message || String(e) })
      }
    }

    this.#deviceById.clear()
    this.#deviceConfigById.clear()
    this.#stateById.clear()

    this.#blockTokensByDeviceId.clear()
    this.#blockedDeviceIdsByToken.clear()
  }

  list() {
    const devices = []

    for (const cfg of this.#deviceConfigById.values()) {
      const id = cfg.id
      const state = this.#stateById.get(id) || 'unknown'
      const started = this.#deviceById.has(id)

      devices.push({
        id,
        publishAs: cfg.publishAs ?? id,
        kind: cfg.kind ?? null,
        domain: cfg.domain ?? null,
        state,
        started,
      })
    }

    return { devices }
  }

  block(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) return { ok: false, error: deviceErrorCodes.deviceNotFound }

    const inst = this.#deviceById.get(id)
    if (inst?.block) {
      try {
        inst.block(reason)
      } catch (e) {
        this.#logger.error('device_block_failed', { deviceId: id, error: e?.message || String(e) })
      }
    }

    this.#setState(id, 'manualBlocked', { reason })
    return { ok: true }
  }

  unblock(deviceId, reason = 'manual') {
    const id = String(deviceId || '').trim()
    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) return { ok: false, error: deviceErrorCodes.deviceNotFound }

    const current = this.#stateById.get(id)
    if (current === 'active') {
      return { ok: true, note: 'already_active' }
    }

    const inst = this.#deviceById.get(id)

    if (!inst) {
      const ok = this.#ensureStarted(cfg, { reason })
      return ok ? { ok: true } : { ok: false, error: deviceErrorCodes.startFailed }
    }

    try {
      inst.unblock?.()
      return { ok: true }
    } catch (e) {
      this.#logger.error('device_unblock_failed', { deviceId: id, error: e?.message || String(e) })
      this.#setState(id, 'degraded', {
        phase: 'unblock',
        reason,
        error: e?.message || String(e),
        errorCode: e?.code ? String(e.code) : null,
      })
      return { ok: false, error: deviceErrorCodes.startFailed }
    }
  }

  blockDevices({ deviceIds, reason, owner } = {}) {
    const ids = Array.isArray(deviceIds)
      ? deviceIds.map((x) => String(x || '').trim()).filter(Boolean)
      : []

    if (!ids.length) {
      return { ok: false, error: 'missing_deviceIds' }
    }

    const r = String(reason || '').trim() || 'manual'
    const o = String(owner || '').trim() || 'unknown'

    this.#blockTokenSeq += 1
    const token = `block:${Date.now()}:${this.#blockTokenSeq}`

    const blocked = new Set()

    for (const id of ids) {
      const cfg = this.#deviceConfigById.get(id)
      if (!cfg) continue

      const current = this.#stateById.get(id)
      if (current === 'manualBlocked') {
        continue
      }

      let tokens = this.#blockTokensByDeviceId.get(id)
      if (!tokens) {
        tokens = new Set()
        this.#blockTokensByDeviceId.set(id, tokens)
      }

      const wasEmpty = tokens.size === 0
      tokens.add(token)

      blocked.add(id)

      if (wasEmpty) {
        // First token takes effect -> use existing semantics
        this.block(id, r)
      } else {
        // Already blocked by other tokens; no-op
      }
    }

    if (blocked.size) {
      this.#blockedDeviceIdsByToken.set(token, blocked)
    }

    return { ok: true, token }
  }

  unblockDevices({ token } = {}) {
    const t = String(token || '').trim()
    if (!t) return { ok: false, error: 'missing_token' }

    const ids = this.#blockedDeviceIdsByToken.get(t)
    if (!ids || !ids.size) return { ok: true }

    for (const id of ids) {
      const tokens = this.#blockTokensByDeviceId.get(id)
      if (!tokens) continue

      tokens.delete(t)
      if (tokens.size === 0) {
        this.#blockTokensByDeviceId.delete(id)
        this.unblock(id, 'token')
      }
    }

    this.#blockedDeviceIdsByToken.delete(t)
    return { ok: true }
  }

  inject(deviceId, payload) {
    const id = String(deviceId || '').trim()
    const cfg = this.#deviceConfigById.get(id)
    if (!cfg) return { ok: false, error: deviceErrorCodes.deviceNotFound }

    const inst = this.#deviceById.get(id)
    if (!inst) return { ok: false, error: deviceErrorCodes.deviceNotReady }

    try {
      const res = inst.inject(payload)
      if (res && res.ok === false) {
        return res
      }

      return { ok: true }
    } catch (e) {
      return { ok: false, error: deviceErrorCodes.injectFailed, message: e?.message || String(e) }
    }
  }

  #ensureStarted(cfg, detail = {}) {
    const id = cfg.id

    let inst = this.#deviceById.get(id)
    if (!inst) {
      const cfgProtocol = cfg?.protocol || {}
      const usbId = cfgProtocol?.usbId

      let serialPath = cfgProtocol?.serialPath ?? null

      if (usbId && this.#usbInventory?.resolveSerialPath) {
        const res = this.#usbInventory.resolveSerialPath(usbId)
        serialPath = res.ok ? res.serialPath : null
      }

      const effectiveCfg = {
        ...cfg,
        protocol: {
          ...cfgProtocol,
          serialPath,
        },
      }

      try {
        inst = makeDeviceInstance({
          logger: this.#logger,
          clock: this.#clock,
          buses: this.#buses,
          device: effectiveCfg,
          protocolFactory: this.#protocolFactory,
        })

        this.#deviceById.set(id, inst)
      } catch (e) {
        const msg = e?.message || String(e)
        const code = e?.code ? String(e.code) : null

        this.#logger.error('device_create_failed', { deviceId: id, error: msg, errorCode: code })

        this.#setState(id, 'degraded', {
          phase: 'create',
          error: msg,
          errorCode: code,
          ...detail,
        })

        return false
      }
    }

    try {
      inst.start?.()
      return true
    } catch (e) {
      const msg = e?.message || String(e)
      const code = e?.code ? String(e.code) : null

      this.#logger.error('device_start_failed', { deviceId: id, error: msg, errorCode: code })

      this.#setState(id, 'degraded', {
        phase: 'start',
        error: msg,
        errorCode: code,
        ...detail,
      })

      return false
    }
  }

  #setState(deviceId, state, detail = {}) {
    this.#stateById.set(deviceId, state)

    const cfg = this.#deviceConfigById.get(deviceId)
    const publishAs = cfg?.publishAs ?? deviceId

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'deviceManager',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.system.hardware,
        where: busIds.main,
      }),
      payload: {
        deviceId,
        publishAs,
        state,
        detail,
      },
    })
  }

  #handleUsbAttached({ usbId, endpoints }) {
    const relatedDevices = this.#findRelatedUsbDevices(usbId)

    this.#publishUsbHardwareEvent({
      action: 'attached',
      usbId,
      endpoints,
      relatedDevices,
    })

    for (const deviceId of relatedDevices) {
      const cfg = this.#deviceConfigById.get(deviceId)
      if (!cfg) continue

      const configuredState = cfg?.state ?? 'active'
      if (configuredState === 'manualBlocked') continue

      const inst = this.#deviceById.get(deviceId)
      if (!inst?.rebind) continue

      const res = this.#usbInventory.resolveSerialPath(cfg.protocol.usbId)
      if (!res.ok) {
        this.#publishUsbHardwareEvent({
          action: 'rebind_failed',
          usbId: cfg.protocol.usbId,
          relatedDevices: [deviceId],
          detail: { error: res.error },
        })

        continue
      }

      this.#publishUsbHardwareEvent({
        action: 'rebind_attempted',
        usbId: cfg.protocol.usbId,
        relatedDevices: [deviceId],
        detail: { serialPath: res.serialPath },
      })

      try {
        inst.rebind({ serialPath: res.serialPath })

        this.#publishUsbHardwareEvent({
          action: 'rebind_succeeded',
          usbId: cfg.protocol.usbId,
          relatedDevices: [deviceId],
          detail: { serialPath: res.serialPath },
        })
      } catch (e) {
        this.#publishUsbHardwareEvent({
          action: 'rebind_failed',
          usbId: cfg.protocol.usbId,
          relatedDevices: [deviceId],
          detail: { error: e?.message || String(e) },
        })
      }
    }
  }

  #handleUsbDetached({ usbId }) {
    const relatedDevices = this.#findRelatedUsbDevices(usbId)

    this.#publishUsbHardwareEvent({
      action: 'detached',
      usbId,
      relatedDevices,
    })

    for (const deviceId of relatedDevices) {
      const cfg = this.#deviceConfigById.get(deviceId)
      if (!cfg) continue

      const configuredState = cfg?.state ?? 'active'
      if (configuredState === 'manualBlocked') continue

      const inst = this.#deviceById.get(deviceId)
      if (!inst?.rebind) continue

      this.#publishUsbHardwareEvent({
        action: 'rebind_attempted',
        usbId: cfg.protocol.usbId,
        relatedDevices: [deviceId],
        detail: { serialPath: null },
      })

      try {
        inst.rebind({ serialPath: null })

        this.#publishUsbHardwareEvent({
          action: 'rebind_succeeded',
          usbId: cfg.protocol.usbId,
          relatedDevices: [deviceId],
          detail: { serialPath: null },
        })
      } catch (e) {
        this.#publishUsbHardwareEvent({
          action: 'rebind_failed',
          usbId: cfg.protocol.usbId,
          relatedDevices: [deviceId],
          detail: { error: e?.message || String(e) },
        })
      }
    }
  }

  #findRelatedUsbDevices(usbId) {
    const related = []

    for (const cfg of this.#deviceConfigById.values()) {
      const cfgUsbId = cfg?.protocol?.usbId
      if (!cfgUsbId) continue

      if (this.#usbIdMatches(cfgUsbId, usbId)) {
        related.push(cfg.id)
      }
    }

    return related
  }

  #usbIdMatches(cfgUsbId, runtimeUsbId) {
    const aVid = String(cfgUsbId?.vid || '').trim().toLowerCase().replace(/^0x/, '')
    const aPid = String(cfgUsbId?.pid || '').trim().toLowerCase().replace(/^0x/, '')
    const aSerial = (cfgUsbId?.serial !== undefined && cfgUsbId?.serial !== null)
      ? String(cfgUsbId.serial).trim()
      : null

    const bVid = String(runtimeUsbId?.vid || '').trim().toLowerCase().replace(/^0x/, '')
    const bPid = String(runtimeUsbId?.pid || '').trim().toLowerCase().replace(/^0x/, '')
    const bSerial = (runtimeUsbId?.serial !== undefined && runtimeUsbId?.serial !== null)
      ? String(runtimeUsbId.serial).trim()
      : null

    if (!aVid || !aPid || !bVid || !bPid) return false
    if (aVid !== bVid || aPid !== bPid) return false

    if (aSerial) {
      return aSerial === bSerial
    }

    return true
  }

  #publishUsbHardwareEvent({ action, usbId, endpoints, relatedDevices, detail }) {
    this.#usbEventSeq += 1

    this.#mainBus.publish({
      type: eventTypes.system.hardware,
      ts: this.#clock.nowMs(),
      source: 'deviceManager',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.system.hardware,
        where: busIds.main,
      }),
      payload: {
        subsystem: 'usb',
        action,
        seq: this.#usbEventSeq,
        usbId: usbId ? { ...usbId } : undefined,
        endpoints: Array.isArray(endpoints) ? endpoints : undefined,
        relatedDevices: Array.isArray(relatedDevices) ? relatedDevices : [],
        detail: detail && typeof detail === 'object' ? detail : undefined,
      },
    })
  }
}

export default DeviceManager
