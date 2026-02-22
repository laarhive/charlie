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

    // radarId -> { ts, validCount, publishAs, targets: [{ localId, distMm }] }
    lastLd2450ByRadar: new Map(),
  }
}

export class PresenceUiState {
  #cfg
  #stats

  #xform

  #measurements
  #tracks

  #rawTrailByKey
  #trackTrailById
  #trackingSnapshotHealth = null

  constructor({ cfg }) {
    this.#cfg = cfg
    this.#stats = emptyStats()

    this.#xform = new TransformService({ layout: cfg.layout })

    this.#measurements = []
    this.#tracks = []

    this.#rawTrailByKey = new Map()   // key -> [{ ts, xMm, yMm, radarId, localId }]
    this.#trackTrailById = new Map()  // id -> [{ ts, xMm, yMm }]
  }

  setConfig(cfg) {
    this.#cfg = cfg
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

  getRawTrails() {
    this.#pruneRawTrails()
    return this.#rawTrailByKey
  }

  getTrackTrails() {
    this.#pruneTrackTrails()
    return this.#trackTrailById
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

  ingestTrackingSnapshotHealth(payload) {
    this.#trackingSnapshotHealth = payload
  }

  getTrackingSnapshotHealth() {
    return this.#trackingSnapshotHealth
  }

  clearTrails() {
    this.#rawTrailByKey.clear()
    this.#trackTrailById.clear()
  }

  clearPlotData() {
    this.#measurements = []
    this.#tracks = []
    this.#stats.lastLd2450ByRadar.clear()
    this.#stats.measCount = 0
    this.#stats.trackCount = 0
    this.clearTrails()
  }

  #radarOriginWorldMm = (radarId) => {
    const az = Array.isArray(this.#cfg?.layout?.radarAzimuthDeg) ? this.#cfg.layout.radarAzimuthDeg : []
    const tubeDiameterMm = Number(this.#cfg?.layout?.tubeDiameterMm) || 100
    const tubeRadiusMm = tubeDiameterMm / 2

    const phiDeg = Number(az[radarId])
    if (!Number.isFinite(phiDeg)) return { xMm: 0, yMm: 0 }

    const rad = (phiDeg * Math.PI) / 180
    return {
      xMm: tubeRadiusMm * Math.cos(rad),
      yMm: tubeRadiusMm * Math.sin(rad),
    }
  }

  #distFromRadarMm = ({ radarId, xMm, yMm }) => {
    const o = this.#radarOriginWorldMm(radarId)

    const dx = Number(xMm) - Number(o.xMm)
    const dy = Number(yMm) - Number(o.yMm)
    if (![dx, dy].every(Number.isFinite)) return 0

    return Math.sqrt((dx * dx) + (dy * dy))
  }

  #trailCapFor = (keepS, cappedDefault, cappedInfinite) => {
    const k = Number(keepS)
    if (k === -1) return cappedInfinite
    return cappedDefault
  }

  #ingestLd2450Raw(event) {
    const p = event.payload || {}
    const publishAs = String(p.publishAs || '').trim()
    if (!publishAs) return

    const frame = p.frame || {}
    const ts = Number(frame.ts) || Number(event.ts) || Date.now()

    const radarId = this.#resolveRadarIdFromPublishAs(publishAs)
    if (radarId === null) return

    const detections = parseLd2450Detections(frame)

    const targetsForPanel = []

    for (const d of detections) {
      const w = this.#xform.toWorldMm({ radarId, xMm: d.xMm, yMm: d.yMm })

      const distMm = this.#distFromRadarMm({ radarId, xMm: w.xMm, yMm: w.yMm })

      targetsForPanel.push({
        localId: d.localId,
        distMm,
      })

      const m = {
        ts,
        radarId,
        publishAs,
        localId: d.localId,
        xMm: w.xMm,
        yMm: w.yMm,
      }

      this.#measurements.push(m)
      this.#pushRawTrailPoint(m)
    }

    this.#stats.lastLd2450ByRadar.set(radarId, {
      ts,
      validCount: detections.length,
      publishAs,
      targets: targetsForPanel,
    })
  }

  #ingestMainTargets(event) {
    const p = event.payload || {}
    const targets = Array.isArray(p.targets) ? p.targets : []
    const ts = Number(event.ts) || Date.now()

    this.#tracks = targets.map((t) => {
      const out = {
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
      }

      this.#pushTrackTrailPoint({ id: out.id, ts, xMm: out.xMm, yMm: out.yMm })
      return out
    })
  }

  #pushRawTrailPoint(m) {
    const key = `${m.radarId}:${m.localId}`
    let list = this.#rawTrailByKey.get(key)
    if (!list) {
      list = []
      this.#rawTrailByKey.set(key, list)
    }

    list.push(m)

    const cap = this.#trailCapFor(this.#cfg?.draw?.rawTrailKeepS, 900, 50000)
    if (list.length > cap) {
      list.splice(0, list.length - cap)
    }
  }

  #pushTrackTrailPoint({ id, ts, xMm, yMm }) {
    const key = String(id || '')
    if (!key) return

    let list = this.#trackTrailById.get(key)
    if (!list) {
      list = []
      this.#trackTrailById.set(key, list)
    }

    list.push({ ts, xMm, yMm })

    const cap = this.#trailCapFor(this.#cfg?.draw?.trackTrailKeepS, 2000, 80000)
    if (list.length > cap) {
      list.splice(0, list.length - cap)
    }
  }

  #pruneMeasurements() {
    const keepMs = Number(this.#cfg?.draw?.measKeepMs)
    const windowMs = Number.isFinite(keepMs) && keepMs > 0 ? keepMs : 600

    const now = Date.now()
    const cut = now - windowMs

    this.#measurements = this.#measurements.filter((m) => (Number(m.ts) || 0) >= cut)
  }

  #pruneRawTrails() {
    const keepS = Number(this.#cfg?.draw?.rawTrailKeepS)
    if (keepS === 0) {
      this.#rawTrailByKey.clear()
      return
    }

    if (keepS === -1) return

    const keepMs = keepS > 0 ? keepS * 1000 : 0
    if (!keepMs) return

    const now = Date.now()
    const cut = now - keepMs

    for (const [k, list] of this.#rawTrailByKey.entries()) {
      const next = list.filter((p) => (Number(p.ts) || 0) >= cut)
      if (next.length) this.#rawTrailByKey.set(k, next)
      else this.#rawTrailByKey.delete(k)
    }
  }

  #pruneTrackTrails() {
    const keepS = Number(this.#cfg?.draw?.trackTrailKeepS)
    if (keepS === 0) {
      this.#trackTrailById.clear()
      return
    }

    if (keepS === -1) return

    const keepMs = keepS > 0 ? keepS * 1000 : 0
    if (!keepMs) return

    const now = Date.now()
    const cut = now - keepMs

    for (const [id, list] of this.#trackTrailById.entries()) {
      const next = list.filter((p) => (Number(p.ts) || 0) >= cut)
      if (next.length) this.#trackTrailById.set(id, next)
      else this.#trackTrailById.delete(id)
    }
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
