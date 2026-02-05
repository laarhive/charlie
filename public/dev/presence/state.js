// public/dev/radar/state.js
import TransformService from '../presence/transform.js'
import { parseLd2450Detections } from '../presence/ld2450.js'

const emptyStats = function emptyStats() {
  return {
    lastInternalTs: null,
    lastMainTs: null,
    lastRawTs: null,

    measCount: 0,
    trackCount: 0,

    lastLd2450ByRadar: new Map(), // radarId -> { ts, detections, publishAs }
  }
}

export class PresenceUiState {
  #cfg
  #stats

  #xform

  /* measurements are now raw LD2450 -> world transform (browser-side) */
  #measurements

  /* tracks are main-bus presence:targets (global) */
  #tracks

  constructor({ cfg }) {
    this.#cfg = cfg
    this.#stats = emptyStats()

    this.#xform = new TransformService({ layout: cfg.layout })

    this.#measurements = []
    this.#tracks = []
  }

  getConfig() {
    return this.#cfg
  }

  getStats() {
    this.#stats.measCount = this.#measurements.length
    this.#stats.trackCount = this.#tracks.length
    return this.#stats
  }

  getMeasurements() {
    this.#pruneMeasurements()
    return this.#measurements
  }

  getTracks() {
    return this.#tracks
  }

  ingestBusEvent({ bus, event }) {
    if (!event?.type) return

    if (bus === 'presenceInternal') {
      this.#stats.lastInternalTs = event.ts ?? Date.now()
      return
    }

    if (bus === 'presence') {
      this.#stats.lastRawTs = event.ts ?? Date.now()

      if (event.type === 'presenceRaw:ld2450') {
        this.#ingestLd2450Raw(event)
      }

      return
    }

    if (bus === 'main') {
      this.#stats.lastMainTs = event.ts ?? Date.now()

      if (event.type === 'presence:targets') {
        this.#ingestMainTargets(event)
      }

      return
    }
  }

  #ingestLd2450Raw(event) {
    const p = event.payload || {}
    const publishAs = String(p.publishAs || '').trim()
    if (!publishAs) return

    const frame = p.frame || {}
    const ts = Number(frame.ts) || Number(event.ts) || Date.now()

    const radarId = this.#resolveRadarIdFromPublishAs(publishAs)
    if (radarId === null) {
      return
    }

    const detections = parseLd2450Detections(frame)

    this.#stats.lastLd2450ByRadar.set(radarId, {
      ts,
      detections: detections.length,
      publishAs,
    })

    for (const d of detections) {
      const w = this.#xform.toWorldMm({ radarId, xMm: d.xMm, yMm: d.yMm })

      this.#measurements.push({
        ts,
        radarId,
        publishAs,
        localId: d.localId,

        xMm: w.xMm,
        yMm: w.yMm,
      })
    }
  }

  #ingestMainTargets(event) {
    const p = event.payload || {}
    const targets = Array.isArray(p.targets) ? p.targets : []

    this.#tracks = targets.map((t) => ({
      id: String(t.id || ''),
      state: String(t.state || 'confirmed'),

      xMm: this.#roundMm(t.xMm),
      yMm: this.#roundMm(t.yMm),

      vxMmS: this.#roundVel(t.vxMmS),
      vyMmS: this.#roundVel(t.vyMmS),
      speedMmS: this.#roundVel(t.speedMmS),

      ageMs: this.#roundInt(t.ageMs),
      lastSeenMs: this.#roundInt(t.lastSeenMs),

      sourceRadars: Array.isArray(t.sourceRadars) ? t.sourceRadars : [],
    }))
  }

  #pruneMeasurements() {
    const keepMs = Number(this.#cfg?.draw?.measKeepMs)
    const windowMs = Number.isFinite(keepMs) && keepMs > 0 ? keepMs : 600

    const now = Date.now()
    const cut = now - windowMs

    this.#measurements = this.#measurements.filter((m) => (Number(m.ts) || 0) >= cut)
  }

  #resolveRadarIdFromPublishAs(publishAs) {
    const list = Array.isArray(this.#cfg?.layout?.ld2450) ? this.#cfg.layout.ld2450 : []
    for (let i = 0; i < list.length; i += 1) {
      const x = list[i]
      if (!x) continue
      if (x.enabled === false) continue
      if (String(x.publishAs || '') === publishAs) return i
    }

    return null
  }

  #roundMm(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.round(n)
  }

  #roundVel(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0

    if (Math.abs(n) < 0.01) return 0

    return Math.round(n * 100) / 100
  }

  #roundInt(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.round(n)
  }
}

export default PresenceUiState
