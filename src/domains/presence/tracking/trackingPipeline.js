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
      mode: this.#mode(),
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

  #mode() {
    const mode = String(this.#cfg?.tracking?.mode || 'kf')
    if (mode === 'passthrough' || mode === 'assocOnly' || mode === 'kf') return mode
    return 'kf'
  }

  #debugEnabled() {
    return this.#cfg?.debug?.enabled === true
  }

  #getUpdateIntervalMs() {
    const ms = Number(this.#cfg?.tracking?.updateIntervalMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)

    return 100
  }

  #onLd2450Tracks(event) {
    const p = event?.payload || {}
    const ts = Number(p.ts) || Number(event?.ts) || this.#clock.nowMs()
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

        prov: t?.provenance || null,
      })
    }
  }

  #tick() {
    const now = this.#clock.nowMs()
    const mode = this.#mode()
    const debugEnabled = this.#debugEnabled()

    const measurements = this.#drainBuffer()
    const measVarMm2ByRadarId = this.#computeMeasVarByRadar(measurements)

    if (mode === 'passthrough') {
      this.#publishPassthrough(now, measurements, { debugEnabled })
      return
    }

    const dtClampMs = this.#toNonNegInt(this.#cfg?.tracking?.maxDtMs ?? 400)
    const dropTimeoutMs = this.#toNonNegInt(this.#cfg?.tracking?.dropTimeoutMs ?? 1500)

    const confirmEnabled = this.#cfg?.tracking?.association?.newTrackConfirmEnabled !== false
    const confirmCount = this.#toNonNegInt(this.#cfg?.tracking?.association?.newTrackConfirmCount ?? 3)
    const confirmWindowMs = this.#toNonNegInt(this.#cfg?.tracking?.association?.newTrackConfirmWindowMs ?? 400)

    const SPEED_EPS_MM_S = 0.01
    const kfEnabled = mode === 'kf'

    for (const tr of this.#tracksById.values()) {
      tr.updatedThisTick = false
    }

    // 1) predict (kf only)
    const liveTracks = []
    for (const tr of this.#tracksById.values()) {
      if (kfEnabled) {
        const dtMs = Math.min(dtClampMs, Math.max(0, now - tr.lastUpdateTs))
        const dtSec = dtMs / 1000

        tr.kfState = this.#kf.predict(tr.kfState, dtSec)
        tr.xMm = tr.kfState.x[0]
        tr.yMm = tr.kfState.x[1]
        tr.vxMmS = tr.kfState.x[2]
        tr.vyMmS = tr.kfState.x[3]
      }

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

    // 3) update assigned tracks
    for (const [trackId, measIdx] of assignments.entries()) {
      const tr = this.#tracksById.get(trackId)
      if (!tr) continue

      const m = measurements[measIdx]
      const varMm2 = measVarMm2ByRadarId.get(m.radarId) ?? 1
      const sigmaMm = Math.sqrt(Math.max(1, varMm2))

      const assocDebug = this.#computeAssocDebug(tr, m, varMm2)

      if (kfEnabled) {
        const upd = this.#kf.updateWithDebug(tr.kfState, { xMm: m.xMm, yMm: m.yMm }, sigmaMm)
        tr.kfState = upd.state

        tr.xMm = tr.kfState.x[0]
        tr.yMm = tr.kfState.x[1]
        tr.vxMmS = tr.kfState.x[2]
        tr.vyMmS = tr.kfState.x[3]

        tr.debugLast = this.#buildDebug({
          mode,
          updatedThisTick: true,
          m,
          assoc: assocDebug,
          kf: {
            innovationMm: upd.innovationMm,
            sigmaMm: upd.sigmaMm,
          },
        })
      } else {
        tr.xMm = m.xMm
        tr.yMm = m.yMm
        tr.vxMmS = 0
        tr.vyMmS = 0

        tr.debugLast = this.#buildDebug({
          mode,
          updatedThisTick: true,
          m,
          assoc: assocDebug,
          kf: null,
        })
      }

      tr.lastUpdateTs = now
      tr.lastSeenTs = m.ts
      tr.lastRadarId = m.radarId
      tr.lastZoneId = m.zoneId
      tr.updatedThisTick = true

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
      this.#createTrackFromMeasurement(m, now, { confirmEnabled, kfEnabled, mode })
    }

    // 5) prune
    for (const tr of this.#tracksById.values()) {
      const sinceSeen = now - tr.lastSeenTs
      if (sinceSeen >= dropTimeoutMs) tr.drop = true
    }

    for (const [id, tr] of this.#tracksById.entries()) {
      if (tr.drop) this.#tracksById.delete(id)
    }

    // 6) publish
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

      const item = {
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
      }

      if (debugEnabled) {
        const dbg = tr.debugLast || this.#buildDebug({ mode, updatedThisTick: false, m: null, assoc: null, kf: null })

        if (!tr.updatedThisTick) {
          dbg.updatedThisTick = false
          dbg.assoc = null
          dbg.kf = null
        }

        item.debug = this.#roundDebug(dbg)
      }

      out.push(item)
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.globalTracks,
      ts: now,
      source: this.#controllerId,
      payload: {
        ts: now,
        tracks: out,
        meta: {
          mode,
          bufferedMeas: measurements.length,
          activeTracks: out.length,
          updateIntervalMs: this.#getUpdateIntervalMs(),
        },
      },
    })
  }

  #publishPassthrough(now, measurements, { debugEnabled }) {
    const out = []

    for (const m of measurements) {
      const prov = m.prov || null

      const publishAs = String(prov?.publishAs || '')
      const slotId = Number(prov?.slotId)
      const id = publishAs && Number.isFinite(slotId) ? `m:${publishAs}:${slotId}` : `m:${m.radarId}:${this.#seq++}`

      const item = {
        id,
        state: 'confirmed',

        xMm: Math.round(m.xMm),
        yMm: Math.round(m.yMm),
        vxMmS: 0,
        vyMmS: 0,
        speedMmS: 0,

        ageMs: 0,
        lastSeenMs: Math.max(0, now - m.ts),

        lastRadarId: m.radarId,
        lastZoneId: m.zoneId,
        sourceRadars: [m.radarId],
      }

      if (debugEnabled) {
        item.debug = this.#roundDebug(this.#buildDebug({
          mode: 'passthrough',
          updatedThisTick: true,
          m,
          assoc: null,
          kf: null,
        }))
      }

      out.push(item)
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.globalTracks,
      ts: now,
      source: this.#controllerId,
      payload: {
        ts: now,
        tracks: out,
        meta: {
          mode: 'passthrough',
          bufferedMeas: measurements.length,
          activeTracks: out.length,
          updateIntervalMs: this.#getUpdateIntervalMs(),
        },
      },
    })
  }

  #buildDebug({ mode, updatedThisTick, m, assoc, kf }) {
    if (!m) {
      return {
        mode,
        updatedThisTick: Boolean(updatedThisTick),
        lastMeas: null,
        transform: null,
        assoc: null,
        kf: null,
      }
    }

    const prov = m.prov || null

    const lastMeas = prov ? {
      bus: 'presence',
      publishAs: prov.publishAs ?? null,
      radarId: Number.isFinite(Number(prov.radarId)) ? Number(prov.radarId) : m.radarId,
      slotId: Number.isFinite(Number(prov.slotId)) ? Number(prov.slotId) : null,
      measTs: Number.isFinite(Number(prov.measTs)) ? Number(prov.measTs) : m.ts,

      localMm: prov.localMm ?? null,
      worldMeasMm: prov.worldMeasMm ?? { xMm: m.xMm, yMm: m.yMm },

      frame: prov.frame ?? null,
    } : {
      bus: 'presence',
      publishAs: null,
      radarId: m.radarId,
      slotId: null,
      measTs: m.ts,

      localMm: null,
      worldMeasMm: { xMm: m.xMm, yMm: m.yMm },

      frame: null,
    }

    return {
      mode,
      updatedThisTick: Boolean(updatedThisTick),
      lastMeas,
      transform: prov?.transform ?? null,
      assoc: assoc ?? null,
      kf: kf ?? null,
    }
  }

  #roundDebug(debug) {
    if (!debug) return null

    const round2 = (x) => Number.isFinite(x) ? Math.round(x * 100) / 100 : x
    const round1 = (x) => Number.isFinite(x) ? Math.round(x * 10) / 10 : x
    const roundMm = (x) => Number.isFinite(x) ? Math.round(x) : x

    const lastMeas = debug.lastMeas ? {
      ...debug.lastMeas,
      localMm: debug.lastMeas.localMm ? { xMm: roundMm(debug.lastMeas.localMm.xMm), yMm: roundMm(debug.lastMeas.localMm.yMm) } : null,
      worldMeasMm: debug.lastMeas.worldMeasMm ? { xMm: roundMm(debug.lastMeas.worldMeasMm.xMm), yMm: roundMm(debug.lastMeas.worldMeasMm.yMm) } : null,
      frame: debug.lastMeas.frame ? {
        ...debug.lastMeas.frame,
        slots: Array.isArray(debug.lastMeas.frame.slots)
          ? debug.lastMeas.frame.slots.map((s) => ({
            slotId: Number(s?.slotId),
            valid: s?.valid === true,
            xMm: roundMm(Number(s?.xMm) || 0),
            yMm: roundMm(Number(s?.yMm) || 0),
          }))
          : [],
      } : null,
    } : null

    const transform = debug.transform ? {
      phiDeg: round2(debug.transform.phiDeg),
      deltaDeg: round2(debug.transform.deltaDeg),
      tubeRadiusMm: roundMm(debug.transform.tubeRadiusMm),
    } : null

    const assoc = debug.assoc ? {
      gateD2: round2(debug.assoc.gateD2),
      assigned: Boolean(debug.assoc.assigned),
    } : null

    const kf = debug.kf ? {
      innovationMm: debug.kf.innovationMm ? { dx: roundMm(debug.kf.innovationMm.dx), dy: roundMm(debug.kf.innovationMm.dy) } : null,
      sigmaMm: round1(debug.kf.sigmaMm),
    } : null

    return {
      mode: debug.mode,
      updatedThisTick: Boolean(debug.updatedThisTick),
      lastMeas,
      transform,
      assoc,
      kf,
    }
  }

  #computeAssocDebug(tr, m, varMm2) {
    const dx = m.xMm - tr.xMm
    const dy = m.yMm - tr.yMm
    const gateD2 = ((dx * dx) + (dy * dy)) / Math.max(1, varMm2)

    return { gateD2, assigned: true }
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

  #createTrackFromMeasurement(m, now, { confirmEnabled, kfEnabled, mode }) {
    const id = `t${now}:${this.#seq++}`

    let init = null
    if (kfEnabled) {
      init = this.#kf.createInitial({
        xMm: m.xMm,
        yMm: m.yMm,
        initialPosVarMm2: this.#cfg?.tracking?.kf?.initialPosVarMm2 ?? 250000,
        initialVelVarMm2S2: this.#cfg?.tracking?.kf?.initialVelVarMm2S2 ?? 1440000,
      })
    }

    const xMm = kfEnabled ? init.x[0] : m.xMm
    const yMm = kfEnabled ? init.x[1] : m.yMm
    const vxMmS = kfEnabled ? init.x[2] : 0
    const vyMmS = kfEnabled ? init.x[3] : 0

    this.#tracksById.set(id, {
      id,
      state: confirmEnabled ? 'tentative' : 'confirmed',

      kfState: init,
      xMm,
      yMm,
      vxMmS,
      vyMmS,

      createdTs: now,
      firstSeenTs: now,
      lastSeenTs: m.ts,
      lastUpdateTs: now,

      confirmHits: 1,

      lastRadarId: m.radarId,
      lastZoneId: m.zoneId,

      sourceRadars: new Set([m.radarId]),
      drop: false,

      updatedThisTick: true,
      debugLast: this.#buildDebug({ mode, updatedThisTick: true, m, assoc: null, kf: null }),
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
