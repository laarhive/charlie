// src/domains/presence/tracking/trackingPipeline.js

import domainEventTypes from '../../domainEventTypes.js'
import { KalmanFilterCv2d } from './kalmanFilterCv2d.js'
import { AssociationEngine } from './associationEngine.js'
import { TransformService } from '../transform/transformService.js'
import { makeStreamKey } from '../../../core/eventBus.js'
import { busIds } from '../../../app/buses.js'

import RadarSnapshotBuffer from './snapshot/radarSnapshotBuffer.js'
import TrackingObservationStage from './observation/trackingObservationStage.js'
import FusionClusterer from './fusion/fusionClusterer.js'
import TrackingHealthPublisher from './debug/trackingHealthPublisher.js'
import { buildDebug, roundDebug } from './debug/trackingDebugFormat.js'

export class TrackingPipeline {
  #logger
  #clock
  #controllerId
  #presenceInternalBus

  #cfg
  #enabled

  #kf
  #assoc
  #transform

  #snapshot
  #observe
  #fuse
  #health

  #tracksById = new Map()
  #seq = 0

  #timer = null
  #unsubscribe = null

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

    this.#transform = new TransformService({
      config: this.#cfg,
      logger: this.#logger,
    })

    this.#snapshot = new RadarSnapshotBuffer({ clock: this.#clock, cfg: this.#cfg })
    this.#observe = new TrackingObservationStage({ cfg: this.#cfg })
    this.#fuse = new FusionClusterer({ cfg: this.#cfg, transform: this.#transform })

    this.#health = new TrackingHealthPublisher({
      logger: this.#logger,
      clock: this.#clock,
      controllerId: this.#controllerId,
      presenceInternalBus: this.#presenceInternalBus,
      cfg: this.#cfg,
      streamKeyWho: this.streamKeyWho,
    })

    if (!this.#presenceInternalBus?.subscribe || !this.#presenceInternalBus?.publish) {
      throw new Error('TrackingPipeline requires presenceInternalBus.subscribe+publish')
    }
  }

  get streamKeyWho() { return 'presenceController.trackingPipeline' }

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

    this.#tracksById.clear()

    this.#snapshot.dispose()
    this.#observe.dispose()
    this.#health.dispose()
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
    return 50
  }

  #stripProvenanceForTracking(prov, { debugEnabled }) {
    if (!prov || typeof prov !== 'object') return null
    if (debugEnabled) return prov

    return {
      publishAs: prov.publishAs ?? null,
      radarId: prov.radarId ?? null,
      slotId: prov.slotId ?? null,
      measTs: prov.measTs ?? null,

      localMm: prov.localMm ?? null,
    }
  }

  #onLd2450Tracks(event) {
    const p = event?.payload || {}
    const debugEnabled = this.#debugEnabled()

    const recvTs = Number(event?.ts)
    if (!Number.isFinite(recvTs) || recvTs <= 0) {
      throw new Error('ld2450Tracks event.ts must be present')
    }

    const radarId = Number(p.radarId)
    if (!Number.isFinite(radarId)) return

    const publishAs = String(p.publishAs || '').trim()
    const zoneId = String(p.zoneId || '')

    const measTsRaw = Number(p.measTs)
    if (!Number.isFinite(measTsRaw) || measTsRaw <= 0) return

    const prevMeasTs = this.#snapshot.getLatestMeasTs(radarId)

    let measTs = measTsRaw
    if (prevMeasTs > 0 && measTsRaw < prevMeasTs) {
      this.#health.noteSanity('measWentBackwards', { radarId, measTs: measTsRaw, prevMeasTs })
      measTs = prevMeasTs + 1
    }

    const recvLagMs = Math.max(0, recvTs - measTs)
    if (recvTs < measTs) {
      this.#health.noteSanity('negativeRecvLag', { radarId, recvTs, measTs })
    }

    const hugeRecvLagMs = Number(this.#cfg?.tracking?.health?.recvLagHugeMs ?? 500)
    if (Number.isFinite(hugeRecvLagMs) && hugeRecvLagMs > 0 && recvLagMs > hugeRecvLagMs) {
      this.#health.noteSanity('recvLagHuge', { radarId, recvLagMs, hugeRecvLagMs })
    }

    const slotCountMax = Number(this.#cfg?.tracking?.health?.slotCountMax ?? 3)
    const slotCount = Number(p?.meta?.slotCount)
    if (Number.isFinite(slotCountMax) && slotCountMax > 0 && Number.isFinite(slotCount) && slotCount > slotCountMax) {
      this.#health.noteSanity('slotCountTooHigh', { radarId, slotCount, slotCountMax })
    }

    const detCountMeta = Number(p?.meta?.detectionCount)
    if (Number.isFinite(detCountMeta) && Number.isFinite(slotCount) && detCountMeta > slotCount) {
      this.#health.noteSanity('detectionsGtSlots', { radarId, detectionCount: detCountMeta, slotCount })
    }

    const tracks = Array.isArray(p.tracks) ? p.tracks : []
    const observations = []

    for (const t of tracks) {
      const w = t?.world || {}
      const xMm = Number(w.xMm)
      const yMm = Number(w.yMm)

      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) {
        this.#health.noteSanity('nonFiniteWorld', { radarId })
        continue
      }

      const prov = this.#stripProvenanceForTracking(t?.provenance || null, { debugEnabled })

      observations.push({
        measTs,
        radarId,
        zoneId,
        xMm,
        yMm,
        prov,
      })
    }

    const entry = {
      measTs,
      recvTs,
      radarId,
      zoneId,
      publishAs,
      measurements: observations,
      detectionCount: observations.length,
      slotCount: Number.isFinite(slotCount) ? slotCount : null,
    }

    if (debugEnabled) {
      entry.debug = {
        meta: p?.meta || null,
        ingestDebug: p?.debug || null,
        timing: {
          measTsRaw,
          measTsClamped: measTs,
          prevMeasTs: prevMeasTs || null,
        },
      }
    }

    const now = this.#clock.nowMs()
    this.#snapshot.ingestEntry(radarId, entry, now)
  }

  #tick() {
    const now = this.#clock.nowMs()
    const mode = this.#mode()
    const debugEnabled = this.#debugEnabled()

    this.#snapshot.cleanup(now)
    this.#observe.cleanup(now)

    const snapshot = this.#snapshot.makeSnapshot(now, { debugEnabled })
    const rawObs = snapshot.observations

    const stage = this.#observe.process({ observations: rawObs, now })
    const filtered = stage.filtered
    const deduped = stage.deduped
    const measVarMm2ByIdx = stage.measVarMm2ByIdx

    const fusion = this.#fuse.cluster({
      observations: deduped,
      measVarMm2ByIdx,
      now,
      debugEnabled,
    })

    const observations = fusion.observations
    const fusedVarMm2ByIdx = fusion.measVarMm2ByIdx

    const tickLag = this.#health.computeTickLagStats(now, observations)

    this.#health.maybePublish(now, {
      snapshotMeta: snapshot.meta,
      snapshotRadars: snapshot.radars,
      tickLag,
      meas: {
        measIn: snapshot.meta.measIn,
        measFiltered: filtered.length,
        measDeduped: deduped.length,
        measFused: observations.length,
      },
      fusionDebug: fusion.debug,
    })

    if (mode === 'passthrough') {
      this.#publishPassthrough(now, observations, fusedVarMm2ByIdx, {
        debugEnabled,
        snapshotMeta: snapshot.meta,
        snapshotDebug: snapshot.debug,
        measFiltered: filtered.length,
        measDeduped: deduped.length,
        measFused: observations.length,
        tickLag,
        fusionDebug: fusion.debug,
      })
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

    const assocInput = liveTracks.map((t) => ({
      id: t.id,
      xMm: t.xMm,
      yMm: t.yMm,
      radarId: t.lastRadarId ?? null,
    }))

    const { assignments, unassignedMeas } = this.#assoc.associate({
      tracks: assocInput,
      measurements: observations,
      measVarMm2ByIdx: fusedVarMm2ByIdx,
    })

    const unassignedSet = new Set(unassignedMeas)

    for (const [trackId, measIdx] of assignments.entries()) {
      const tr = this.#tracksById.get(trackId)
      if (!tr) continue

      let idx = measIdx
      let m = observations[idx]

      if (!this.#shouldAcceptRadarSwitch(tr, m)) {
        const fbIdx = this.#findFallbackMeasIdxSameRadar(tr, observations, unassignedSet, fusedVarMm2ByIdx)
        if (fbIdx == null) continue

        unassignedSet.delete(fbIdx)
        idx = fbIdx
        m = observations[idx]
      }

      const varMm2 = Number(fusedVarMm2ByIdx[idx]) || 1
      const sigmaMm = Math.sqrt(Math.max(1, varMm2))
      const assocDebug = this.#computeAssocDebug(tr, m, varMm2)

      if (kfEnabled) {
        const upd = this.#kf.updateWithDebug(tr.kfState, { xMm: m.xMm, yMm: m.yMm }, sigmaMm)
        tr.kfState = upd.state

        tr.xMm = tr.kfState.x[0]
        tr.yMm = tr.kfState.x[1]
        tr.vxMmS = tr.kfState.x[2]
        tr.vyMmS = tr.kfState.x[3]

        tr.debugLast = buildDebug({
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

        tr.debugLast = buildDebug({
          mode,
          updatedThisTick: true,
          m,
          assoc: assocDebug,
          kf: null,
        })
      }

      tr.lastUpdateTs = now
      tr.lastSeenTs = now

      tr.lastRadarId = m.radarId
      tr.lastZoneId = m.zoneId
      tr.updatedThisTick = true

      if (Array.isArray(m.sourceRadars) && m.sourceRadars.length > 0) {
        for (const rid of m.sourceRadars) tr.sourceRadars.add(rid)
      } else {
        tr.sourceRadars.add(m.radarId)
      }

      if (confirmEnabled && tr.state === 'tentative') {
        tr.confirmHits += 1
        if (tr.confirmHits >= confirmCount && (now - tr.firstSeenTs) <= confirmWindowMs) {
          tr.state = 'confirmed'
        }
      }
    }

    for (const idx of unassignedMeas) {
      const m = observations[idx]
      if (!this.#canSpawnNewTrack(m)) continue
      this.#createTrackFromMeasurement(m, now, { confirmEnabled, kfEnabled, mode })
    }

    for (const tr of this.#tracksById.values()) {
      const sinceSeen = now - tr.lastSeenTs
      if (sinceSeen >= dropTimeoutMs) tr.drop = true
    }

    for (const [id, tr] of this.#tracksById.entries()) {
      if (tr.drop) this.#tracksById.delete(id)
    }

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
        const dbg = tr.debugLast || buildDebug({ mode, updatedThisTick: false, m: null, assoc: null, kf: null })

        if (!tr.updatedThisTick) {
          dbg.updatedThisTick = false
          dbg.assoc = null
          dbg.kf = null
        }

        item.debug = roundDebug(dbg)
      }

      out.push(item)
    }

    const meta = {
      mode,

      ...snapshot.meta,

      measFiltered: filtered.length,
      measDeduped: deduped.length,
      measFused: observations.length,

      tickLagSamples: tickLag.tickLagSamples,
      tickLagMsMax: tickLag.tickLagMsMax,
      tickLagMsP95: tickLag.tickLagMsP95,

      activeTracks: out.length,
      tickIntervalMs: this.#getUpdateIntervalMs(),
    }

    if (debugEnabled) {
      meta.fusion = fusion.debug
    }

    if (debugEnabled && snapshot.debug) {
      meta.debug = snapshot.debug
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.globalTracks,
      ts: now,
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: domainEventTypes.presence.globalTracks,
        where: busIds.presenceInternal,
      }),
      payload: {
        publishAs: this.streamKeyWho,
        tracks: out,
        meta,
      },
    })
  }

  #publishPassthrough(now, observations, measVarMm2ByIdx, { debugEnabled, snapshotMeta, snapshotDebug, measFiltered, measDeduped, measFused, tickLag, fusionDebug }) {
    const out = []

    for (let i = 0; i < observations.length; i += 1) {
      const m = observations[i]
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
        lastSeenMs: Math.max(0, now - m.measTs),

        lastRadarId: m.radarId,
        lastZoneId: m.zoneId,
        sourceRadars: Array.isArray(m.sourceRadars) ? m.sourceRadars : [m.radarId],
      }

      if (debugEnabled) {
        item.debug = roundDebug(buildDebug({
          mode: 'passthrough',
          updatedThisTick: true,
          m,
          assoc: null,
          kf: {
            sigmaMm: Math.sqrt(Math.max(1, Number(measVarMm2ByIdx[i]) || 1)),
            innovationMm: null,
          },
        }))
      }

      out.push(item)
    }

    const meta = {
      mode: 'passthrough',

      ...snapshotMeta,

      measFiltered: Number(measFiltered) || observations.length,
      measDeduped: Number(measDeduped) || observations.length,
      measFused: Number(measFused) || observations.length,

      tickLagSamples: tickLag?.tickLagSamples ?? 0,
      tickLagMsMax: tickLag?.tickLagMsMax ?? 0,
      tickLagMsP95: tickLag?.tickLagMsP95 ?? 0,

      activeTracks: out.length,
      tickIntervalMs: this.#getUpdateIntervalMs(),
    }

    if (debugEnabled) {
      meta.fusion = fusionDebug
    }

    if (debugEnabled && snapshotDebug) {
      meta.debug = snapshotDebug
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.globalTracks,
      ts: now,
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: domainEventTypes.presence.globalTracks,
        where: busIds.presenceInternal,
      }),
      payload: {
        publishAs: this.streamKeyWho,
        tracks: out,
        meta,
      },
    })
  }

  #shouldAcceptRadarSwitch(tr, m) {
    if (tr.lastRadarId == null || tr.lastRadarId === m.radarId) {
      return true
    }

    const marginDeg = Number(this.#cfg?.tracking?.handover?.bearingSwitchMarginDeg ?? 8)

    const q = this.#cfg?.quality || {}
    const fullDeg = Number(q.edgeBearingFullDeg ?? 30)
    const cutoffDeg = Number(q.edgeBearingCutoffDeg ?? 45)

    const newLocal = m?.prov?.localMm
    const oldLocal = tr?.debugLast?.lastMeas?.localMm

    if (!newLocal || !oldLocal) {
      return true
    }

    const absNew = Math.abs(Math.atan2(Number(newLocal.xMm), Number(newLocal.yMm)) * 180 / Math.PI)
    const absOld = Math.abs(Math.atan2(Number(oldLocal.xMm), Number(oldLocal.yMm)) * 180 / Math.PI)

    if (Number.isFinite(cutoffDeg) && Number.isFinite(fullDeg)) {
      const EDGE = cutoffDeg - 2
      const CENTER = fullDeg + 2

      if (absOld >= EDGE && absNew <= CENTER) {
        return true
      }
    }

    return (absNew + marginDeg) < absOld
  }

  #findFallbackMeasIdxSameRadar(tr, observations, unassignedSet, measVarMm2ByIdx) {
    const radarId = tr.lastRadarId
    if (radarId == null) return null

    const gateD2Max = Number(this.#cfg?.tracking?.association?.gateD2Max ?? 9.21)

    let bestIdx = null
    let bestD2 = Infinity

    for (const idx of unassignedSet) {
      const m = observations[idx]
      if (!m || m.radarId !== radarId) continue

      const varMm2 = Number(measVarMm2ByIdx[idx]) || 1

      const dx = m.xMm - tr.xMm
      const dy = m.yMm - tr.yMm
      const d2 = ((dx * dx) + (dy * dy)) / Math.max(1, varMm2)

      if (d2 <= gateD2Max && d2 < bestD2) {
        bestD2 = d2
        bestIdx = idx
      }
    }

    return bestIdx
  }

  #computeAssocDebug(tr, m, varMm2) {
    const dx = m.xMm - tr.xMm
    const dy = m.yMm - tr.yMm
    const gateD2 = ((dx * dx) + (dy * dy)) / Math.max(1, varMm2)

    return { gateD2, assigned: true }
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
      lastSeenTs: now,
      lastUpdateTs: now,

      confirmHits: 1,

      lastRadarId: m.radarId,
      lastZoneId: m.zoneId,

      sourceRadars: new Set(Array.isArray(m.sourceRadars) ? m.sourceRadars : [m.radarId]),
      drop: false,

      updatedThisTick: true,
      debugLast: buildDebug({ mode, updatedThisTick: true, m, assoc: null, kf: null }),
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
