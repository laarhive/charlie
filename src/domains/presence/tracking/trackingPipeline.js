// src/domains/presence/tracking/trackingPipeline.js
import domainEventTypes from '../../domainEventTypes.js'
import { KalmanFilterCv2d } from './kalmanFilterCv2d.js'
import { AssociationEngine } from './associationEngine.js'

export class TrackingPipeline {
  #logger
  #clock
  #controllerId

  #presenceInternalBus

  #cfg
  #enabled

  #kf
  #assoc

  #buffer

  #tracksById
  #seq

  #timer
  #unsubscribe

  constructor({ logger, clock, controllerId, presenceInternalBus, controllerConfig }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId || 'presenceController'
    this.#presenceInternalBus = presenceInternalBus

    this.#cfg = controllerConfig || {}
    this.#enabled = (this.#cfg?.enabled !== false)

    this.#kf = new KalmanFilterCv2d({
      procNoiseAccelMmS2: this.#cfg?.tracking?.kf?.procNoiseAccelMmS2 ?? 1200,
      measNoiseBaseMm: this.#cfg?.tracking?.kf?.measNoiseBaseMm ?? 160,
    })

    this.#assoc = new AssociationEngine({
      gateD2Max: this.#cfg?.tracking?.association?.gateD2Max ?? 9.21,
    })

    this.#buffer = []
    this.#tracksById = new Map()
    this.#seq = 0

    this.#timer = null
    this.#unsubscribe = null

    if (!this.#presenceInternalBus?.subscribe || !this.#presenceInternalBus?.publish) {
      throw new Error('TrackingPipeline requires presenceInternalBus.subscribe+publish')
    }
  }

  start() {
    if (!this.#enabled) {
      this.#logger?.notice?.('presence_tracking_disabled', { controllerId: this.#controllerId })
      return
    }

    if (this.#unsubscribe || this.#timer) return

    this.#unsubscribe = this.#presenceInternalBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.presence.ld2450Tracks) return
      this.#onLd2450Tracks(event)
    })

    const intervalMs = this.#getUpdateIntervalMs()
    this.#timer = setInterval(() => this.#tick(), intervalMs)

    this.#logger?.notice?.('presence_tracking_started', {
      controllerId: this.#controllerId,
      updateIntervalMs: intervalMs,
    })
  }

  dispose() {
    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    this.#buffer = []
    this.#tracksById.clear()
  }

  #getUpdateIntervalMs() {
    const ms = Number(this.#cfg?.tracking?.updateIntervalMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)

    return 100
  }

  #onLd2450Tracks(event) {
    const p = event?.payload || {}
    const ts = Number(p.ts) || this.#clock.nowMs()
    const tracks = Array.isArray(p.tracks) ? p.tracks : []

    for (const t of tracks) {
      const w = t?.world || {}
      const xMm = Number(w.xMm)
      const yMm = Number(w.yMm)

      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      this.#buffer.push({
        ts,
        radarId: Number(t.radarId),
        zoneId: String(t.zoneId || ''),
        xMm,
        yMm,
      })
    }
  }

  #tick() {
    const now = this.#clock.nowMs()

    const measurements = this.#drainBuffer()
    const measVarMm2ByRadarId = this.#computeMeasVarByRadar(measurements)

    const dtClampMs = this.#toNonNegInt(this.#cfg?.tracking?.maxDtMs ?? 400)
    const dropTimeoutMs = this.#toNonNegInt(this.#cfg?.tracking?.dropTimeoutMs ?? 1500)

    const confirmEnabled = this.#cfg?.tracking?.association?.newTrackConfirmEnabled !== false
    const confirmCount = this.#toNonNegInt(this.#cfg?.tracking?.association?.newTrackConfirmCount ?? 3)
    const confirmWindowMs = this.#toNonNegInt(this.#cfg?.tracking?.association?.newTrackConfirmWindowMs ?? 400)

    const SPEED_EPS_MM_S = 0.01

    // 1) predict
    const liveTracks = []
    for (const tr of this.#tracksById.values()) {
      const dtMs = Math.min(dtClampMs, Math.max(0, now - tr.lastUpdateTs))
      const dtSec = dtMs / 1000

      tr.kfState = this.#kf.predict(tr.kfState, dtSec)
      tr.xMm = tr.kfState.x[0]
      tr.yMm = tr.kfState.x[1]
      tr.vxMmS = tr.kfState.x[2]
      tr.vyMmS = tr.kfState.x[3]

      liveTracks.push(tr)
    }

    // 2) associate
    const assocInput = liveTracks.map((t) => ({
      id: t.id,
      xMm: t.xMm,
      yMm: t.yMm,
      radarId: t.lastRadarId ?? null,
    }))

    const { assignments, unassignedMeas } = this.#assoc.associate({
      tracks: assocInput,
      measurements,
      measVarMm2ByRadarId,
    })

    // 3) update
    for (const [trackId, measIdx] of assignments.entries()) {
      const tr = this.#tracksById.get(trackId)
      if (!tr) continue

      const m = measurements[measIdx]
      const varMm2 = measVarMm2ByRadarId.get(m.radarId) ?? 1
      const sigmaMm = Math.sqrt(Math.max(1, varMm2))

      tr.kfState = this.#kf.update(tr.kfState, { xMm: m.xMm, yMm: m.yMm }, sigmaMm)

      tr.xMm = tr.kfState.x[0]
      tr.yMm = tr.kfState.x[1]
      tr.vxMmS = tr.kfState.x[2]
      tr.vyMmS = tr.kfState.x[3]

      tr.lastUpdateTs = now
      tr.lastSeenTs = m.ts
      tr.lastRadarId = m.radarId
      tr.lastZoneId = m.zoneId

      tr.sourceRadars.add(m.radarId)

      if (confirmEnabled && tr.state === 'tentative') {
        tr.confirmHits += 1
        if (tr.confirmHits >= confirmCount && (now - tr.firstSeenTs) <= confirmWindowMs) {
          tr.state = 'confirmed'
        }
      }
    }

    // 4) spawn gate
    for (const idx of unassignedMeas) {
      const m = measurements[idx]
      if (!this.#canSpawnNewTrack(m)) continue
      this.#createTrackFromMeasurement(m, now, { confirmEnabled })
    }

    // 5) prune
    for (const tr of this.#tracksById.values()) {
      const sinceSeen = now - tr.lastSeenTs
      if (sinceSeen >= dropTimeoutMs) tr.drop = true
    }

    for (const [id, tr] of this.#tracksById.entries()) {
      if (tr.drop) this.#tracksById.delete(id)
    }

    // 6) publish (rounded + clamped)
    const out = []
    for (const tr of this.#tracksById.values()) {
      let vx = tr.vxMmS
      let vy = tr.vyMmS
      let speedMmS = Math.sqrt((vx * vx) + (vy * vy))

      if (speedMmS < SPEED_EPS_MM_S) {
        vx = 0
        vy = 0
        speedMmS = 0
      }

      out.push({
        id: tr.id,
        state: tr.state,

        xMm: Math.round(tr.xMm),
        yMm: Math.round(tr.yMm),
        vxMmS: Math.round(vx * 100) / 100,
        vyMmS: Math.round(vy * 100) / 100,
        speedMmS: Math.round(speedMmS * 100) / 100,

        ageMs: now - tr.createdTs,
        lastSeenMs: now - tr.lastSeenTs,

        lastRadarId: tr.lastRadarId,
        lastZoneId: tr.lastZoneId,
        sourceRadars: [...tr.sourceRadars],
      })
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.globalTracks,
      ts: now,
      source: this.#controllerId,
      payload: {
        ts: now,
        tracks: out,
        meta: {
          bufferedMeas: measurements.length,
          activeTracks: out.length,
          updateIntervalMs: this.#getUpdateIntervalMs(),
        },
      },
    })
  }

  #drainBuffer() {
    const out = this.#buffer
    this.#buffer = []
    return out
  }

  #computeMeasVarByRadar(measurements) {
    const baseMm = Number(this.#cfg?.tracking?.kf?.measNoiseBaseMm ?? 160)
    const baseVar = Math.max(1, baseMm * baseMm)

    const map = new Map()
    for (const m of measurements) {
      if (!map.has(m.radarId)) map.set(m.radarId, baseVar)
    }

    return map
  }

  #createTrackFromMeasurement(m, now, { confirmEnabled }) {
    const id = `t${now}:${this.#seq++}`

    const init = this.#kf.createInitial({
      xMm: m.xMm,
      yMm: m.yMm,
      initialPosVarMm2: this.#cfg?.tracking?.kf?.initialPosVarMm2 ?? 250000,
      initialVelVarMm2S2: this.#cfg?.tracking?.kf?.initialVelVarMm2S2 ?? 1440000,
    })

    this.#tracksById.set(id, {
      id,
      state: confirmEnabled ? 'tentative' : 'confirmed',

      kfState: init,
      xMm: init.x[0],
      yMm: init.x[1],
      vxMmS: init.x[2],
      vyMmS: init.x[3],

      createdTs: now,
      firstSeenTs: now,
      lastSeenTs: m.ts,
      lastUpdateTs: now,

      confirmHits: 1,

      lastRadarId: m.radarId,
      lastZoneId: m.zoneId,

      sourceRadars: new Set([m.radarId]),
      drop: false,
    })
  }

  #canSpawnNewTrack(m) {
    const gateMm = Number(this.#cfg?.tracking?.association?.newTrackSpawnGateMm)
    if (!Number.isFinite(gateMm) || gateMm <= 0) return true

    const gate2 = gateMm * gateMm

    for (const tr of this.#tracksById.values()) {
      const dx = m.xMm - tr.xMm
      const dy = m.yMm - tr.yMm
      if ((dx * dx + dy * dy) <= gate2) return false
    }

    return true
  }

  #toNonNegInt(x) {
    const n = Number(x)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  }
}

export default TrackingPipeline
