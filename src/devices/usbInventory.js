// src/devices/usbInventory.js
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SerialPort } from 'serialport'

const normalizeHex = function normalizeHex(value) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return null

  return s.startsWith('0x') ? s.slice(2) : s
}

const normalizeSerial = function normalizeSerial(value) {
  const s = String(value || '').trim()
  return s ? s : null
}

const normalizeIface = function normalizeIface(value) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return null

  const m = s.match(/^[0-9a-f]{2}$/i)
  return m ? s : null
}

const extractIfaceFromLinuxById = function extractIfaceFromLinuxById(byIdPath) {
  const s = String(byIdPath || '')
  if (!s) return null

  const m = s.match(/-if([0-9a-f]{2})/i)
  return m ? m[1].toLowerCase() : null
}

const extractIfaceFromPnpId = function extractIfaceFromPnpId(pnpId) {
  const s = String(pnpId || '')
  if (!s) return null

  const m = s.match(/\bMI_([0-9a-f]{2})\b/i)
  return m ? m[1].toLowerCase() : null
}

const makeKey = function makeKey(usbId) {
  const vid = usbId?.vid || ''
  const pid = usbId?.pid || ''
  const serial = usbId?.serial || ''
  const iface = usbId?.iface || ''
  return `${vid}:${pid}:${serial}:${iface}`
}

const stableStringifyEndpoints = function stableStringifyEndpoints(endpoints) {
  const arr = Array.isArray(endpoints) ? endpoints : []

  const norm = arr.map((e) => ({
    serialPath: e?.serialPath ?? null,
    ttyPath: e?.ttyPath ?? null,
    platform: e?.platform ?? null,
    debug: e?.debug ? {
      manufacturer: e.debug.manufacturer ?? null,
      product: e.debug.product ?? null,
      pnpId: e.debug.pnpId ?? null,
      iface: e.debug.iface ?? null,
    } : null,
  }))

  norm.sort((a, b) => {
    const ak = `${a.serialPath || ''}|${a.ttyPath || ''}|${a.platform || ''}`
    const bk = `${b.serialPath || ''}|${b.ttyPath || ''}|${b.platform || ''}`
    return ak.localeCompare(bk)
  })

  return JSON.stringify(norm)
}

const readLinuxByIdMap = async function readLinuxByIdMap() {
  const base = '/dev/serial/by-id'
  const map = new Map()

  let entries = []
  try {
    entries = await fs.readdir(base)
  } catch {
    return map
  }

  for (const name of entries) {
    const full = path.join(base, name)

    try {
      const target = await fs.realpath(full)
      if (target) {
        map.set(target, full)
      }
    } catch {
      // ignore
    }
  }

  return map
}

export class UsbInventory extends EventEmitter {
  #logger
  #clock
  #config
  #platform

  #scanEveryMs
  #timer

  /* key -> { usbId, endpoints, endpointsSig } */
  #byKey

  constructor({ logger, clock, config } = {}) {
    super()

    this.#logger = logger
    this.#clock = clock
    this.#config = config

    this.#platform = process.platform === 'win32' ? 'windows' : 'linux'

    const configured = Number(this.#config?.usbInventory?.scanEveryMs)
    this.#scanEveryMs = Number.isFinite(configured) && configured > 0 ? configured : 1000

    this.#timer = null
    this.#byKey = new Map()
  }

  start() {
    if (this.#timer) return

    this.#scanOnce().catch((e) => {
      this.#logger?.error?.('usb_inventory_scan_failed', { error: e?.message || String(e) })
    })

    this.#timer = setInterval(() => {
      this.#scanOnce().catch((e) => {
        this.#logger?.error?.('usb_inventory_scan_failed', { error: e?.message || String(e) })
      })
    }, this.#scanEveryMs)
  }

  dispose() {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    this.#byKey.clear()
    this.removeAllListeners()
  }

  getSnapshot() {
    const snapshot = new Map()

    for (const v of this.#byKey.values()) {
      snapshot.set(
        { ...v.usbId },
        v.endpoints.map((e) => ({ ...e, debug: e.debug ? { ...e.debug } : undefined }))
      )
    }

    return snapshot
  }

  resolveSerialPath(usbId) {
    const norm = this.#normalizeUsbId(usbId)
    if (!norm.ok) return norm

    const want = norm.usbId
    const keyPrefix = `${want.vid}:${want.pid}:`

    const matches = []
    for (const [k, v] of this.#byKey.entries()) {
      if (!k.startsWith(keyPrefix)) continue

      if (want.serial) {
        const wantSerialKeyPrefix = `${want.vid}:${want.pid}:${want.serial}:`

        if (!k.startsWith(wantSerialKeyPrefix)) continue

        if (want.iface) {
          const wantKey = makeKey(want)
          if (k === wantKey) matches.push(v)
          continue
        }

        matches.push(v)
        continue
      }

      if (want.iface) {
        const wantIfaceSuffix = `:${want.iface}`
        if (!k.endsWith(wantIfaceSuffix)) continue
      }

      matches.push(v)
    }

    if (matches.length === 0) {
      return { ok: false, error: 'USB_NOT_FOUND' }
    }

    if (matches.length > 1) {
      return { ok: false, error: 'USB_AMBIGUOUS' }
    }

    const endpoints = matches[0].endpoints || []
    const best = endpoints.find((e) => e.serialPath) || endpoints[0]

    return { ok: true, serialPath: best?.serialPath || null }
  }

  async #scanOnce() {
    const ports = await SerialPort.list()
    const byIdMap = this.#platform === 'linux' ? await readLinuxByIdMap() : new Map()

    const next = new Map()

    for (const p of ports) {
      const vid = normalizeHex(p.vendorId)
      const pid = normalizeHex(p.productId)

      if (!vid || !pid) continue

      const ttyPath = String(p.path || '').trim() || null
      const linuxById = (this.#platform === 'linux' && ttyPath) ? byIdMap.get(ttyPath) : null

      const serial = normalizeSerial(p.serialNumber)
      const pnpId = this.#platform === 'windows' ? (String(p.pnpId || '').trim() || null) : null

      const ifaceFromLinux = this.#platform === 'linux' ? extractIfaceFromLinuxById(linuxById) : null
      const ifaceFromWindows = this.#platform === 'windows' ? extractIfaceFromPnpId(pnpId) : null
      const iface = normalizeIface(ifaceFromLinux || ifaceFromWindows)

      const usbId = {
        vid,
        pid,
        ...(serial ? { serial } : {}),
        ...(iface ? { iface } : {}),
      }

      const endpoint = {
        serialPath: linuxById || ttyPath,
        ttyPath: this.#platform === 'linux' ? ttyPath : null,
        platform: this.#platform,
        debug: {
          manufacturer: p.manufacturer || undefined,
          product: p.product || undefined,
          pnpId: pnpId || undefined,
          iface: iface || undefined,
        },
      }

      const key = makeKey(usbId)
      const prev = next.get(key)

      if (prev) {
        prev.endpoints.push(endpoint)
      } else {
        next.set(key, { usbId, endpoints: [endpoint] })
      }
    }

    for (const v of next.values()) {
      v.endpointsSig = stableStringifyEndpoints(v.endpoints)
    }

    this.#diffAndApply(next)
  }

  #diffAndApply(next) {
    for (const [key, prev] of this.#byKey.entries()) {
      if (!next.has(key)) {
        this.#byKey.delete(key)
        this.emit('detached', { usbId: { ...prev.usbId } })
      }
    }

    for (const [key, cur] of next.entries()) {
      const prev = this.#byKey.get(key)

      if (!prev) {
        this.#byKey.set(key, cur)

        this.emit('attached', {
          usbId: { ...cur.usbId },
          endpoints: cur.endpoints.map((e) => ({ ...e, debug: e.debug ? { ...e.debug } : undefined })),
        })

        continue
      }

      if (prev.endpointsSig !== cur.endpointsSig) {
        this.#byKey.set(key, cur)

        this.emit('detached', { usbId: { ...prev.usbId } })
        this.emit('attached', {
          usbId: { ...cur.usbId },
          endpoints: cur.endpoints.map((e) => ({ ...e, debug: e.debug ? { ...e.debug } : undefined })),
        })
      }
    }
  }

  #normalizeUsbId(usbId) {
    if (!usbId || typeof usbId !== 'object') {
      return { ok: false, error: 'INVALID_USB_ID' }
    }

    const vid = normalizeHex(usbId.vid)
    const pid = normalizeHex(usbId.pid)
    const serial = normalizeSerial(usbId.serial)
    const iface = normalizeIface(usbId.iface)

    if (!vid || !pid) {
      return { ok: false, error: 'INVALID_USB_ID' }
    }

    return {
      ok: true,
      usbId: {
        vid,
        pid,
        ...(serial ? { serial } : {}),
        ...(iface ? { iface } : {}),
      },
    }
  }
}

export default UsbInventory
