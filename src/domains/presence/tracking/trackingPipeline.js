// src/domains/presence/tracking/trackingPipeline.js
import domainEventTypes from '../../domainEventTypes.js'
import { KalmanFilterCv2d } from './kalmanFilterCv2d.js'
import { AssociationEngine } from './associationEngine.js'
import { TransformService } from '../transform/transformService.js'
import { makeStreamKey } from '../../../core/eventBus.js'
import { busIds } from '../../../app/buses.js'

const clamp01 = function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

const lerp = function lerp(a, b, t) {
  return (a + (b - a) * clamp01(t))
}

const mapScale = function mapScale({ v, full, cutoff, scaleMax }) {
  const vv = Number(v)
  const f = Number(full)
  const c = Number(cutoff)
  const sMax = Number(scaleMax)

  if (![vv, f, c, sMax].every(Number.isFinite)) return 1
  if (sMax <= 1) return 1

  if (vv <= f) return 1
  if (vv >= c) return sMax

  const t = (vv - f) / Math.max(1e-9, (c - f))
  return lerp(1, sMax, t)
}

class Uf {
  #parent
  #rank

  constructor(n) {
    this.#parent = Array.from({ length: n }, (_, i) => i)
    this.#rank = Array(n).fill(0)
  }

  find(x) {
    let p = this.#parent[x]
    if (p !== x) {
      p = this.find(p)
      this.#parent[x] = p
    }

    return p
  }

  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)

    if (ra === rb) return

    const ka = this.#rank[ra]
    const kb = this.#rank[rb]

    if (ka < kb) {
      this.#parent[ra] = rb
      return
    }

    if (kb < ka) {
      this.#parent[rb] = ra
      return
    }

    this.#parent[rb] = ra
    this.#rank[ra] += 1
  }
}

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

  #latestByRadarId
  #radarsExpectedSet
  #radarsSeenEver
  #lastTickMeasTsByRadarId

  #tracksById
  #seq

  #timer
  #unsubscribe

  #stuckTicks

  #jitterLastByKey = new Map()
  #jumpLastByKey = new Map()

  #healthLastPublishTs
  #healthSeq

  #sanityCounters

  #bufferByRadarId = new Map()

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

    this.#latestByRadarId = new Map()
    this.#radarsExpectedSet = this.#buildExpectedRadarIdSet()
    this.#radarsSeenEver = new Set()
    this.#lastTickMeasTsByRadarId = new Map()

    this.#tracksById = new Map()
    this.#seq = 0

    this.#timer = null
    this.#unsubscribe = null

    this.#stuckTicks = 0
    this.#jitterLastByKey = new Map()

    this.#healthLastPublishTs = 0
    this.#healthSeq = 0

    this.#sanityCounters = this.#makeEmptySanityCounters()

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

    this.#latestByRadarId.clear()
    this.#radarsSeenEver.clear()
    this.#lastTickMeasTsByRadarId.clear()

    this.#tracksById.clear()
    this.#jitterLastByKey.clear()
    this.#jumpLastByKey.clear()

    this.#stuckTicks = 0
    this.#healthLastPublishTs = 0
    this.#healthSeq = 0
    this.#sanityCounters = this.#makeEmptySanityCounters()
    this.#bufferByRadarId.clear()
  }

  #getJitterDelayMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.jitterDelayMs)
    if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
    return 0
  }

  #getRadarBufferMaxFrames() {
    const n = Number(this.#cfg?.tracking?.snapshot?.radarBufferMaxFrames)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
    return 5
  }

  #getRadarBufferWindowMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.radarBufferWindowMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 4000
  }

  #getWaitForAllEnabled() {
    return this.#cfg?.tracking?.snapshot?.waitForAll?.enabled === true
  }

  #getWaitForAllTimeoutMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.waitForAll?.timeoutMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 120
  }

  #pushRadarBuffer(radarId, entry, now) {
    const rid = Number(radarId)
    if (!Number.isFinite(rid)) return

    const maxFrames = this.#getRadarBufferMaxFrames()
    const windowMs = this.#getRadarBufferWindowMs()

    const buf = this.#bufferByRadarId.get(rid) || []
    buf.push(entry)

    // Keep only recent by time window (measTs), then cap by count.
    const cutoffTs = now - windowMs
    let keep = buf.filter((e) => Number(e?.measTs) >= cutoffTs)

    if (maxFrames > 0 && keep.length > maxFrames) {
      keep = keep.slice(keep.length - maxFrames)
    }

    this.#bufferByRadarId.set(rid, keep)
  }

  #cleanupRadarBuffers(now) {
    const windowMs = this.#getRadarBufferWindowMs()
    const ttlMs = windowMs * 2

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    const cutoffTs = now - ttlMs

    for (const [rid, buf] of this.#bufferByRadarId.entries()) {
      if (!Array.isArray(buf) || buf.length === 0) {
        this.#bufferByRadarId.delete(rid)
        continue
      }

      const keep = buf.filter((e) => {
        const ts = Number(e?.measTs)
        return Number.isFinite(ts) && ts >= cutoffTs
      })

      if (keep.length === 0) {
        this.#bufferByRadarId.delete(rid)
        continue
      }

      this.#bufferByRadarId.set(rid, keep)
    }
  }

  #selectRadarEntry(radarId, sampleTs, now) {
    const buf = this.#bufferByRadarId.get(radarId)
    if (!Array.isArray(buf) || buf.length === 0) return null

    // Prefer newest entry with measTs <= sampleTs
    let best = null
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      const e = buf[i]
      const ts = Number(e?.measTs)
      if (!Number.isFinite(ts)) continue

      if (ts <= sampleTs) {
        best = e
        break
      }
    }

    // If nothing <= sampleTs, best-effort newest entry overall.
    if (!best) best = buf[buf.length - 1]

    return best || null
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

  #getHealthIntervalMs() {
    const ms = Number(this.#cfg?.tracking?.health?.intervalMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 1000
  }

  #getStaleMeasMaxMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.staleMeasMaxMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 250
  }

  #getRadarMissingTimeoutMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.radarMissingTimeoutMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 1500
  }

  #buildExpectedRadarIdSet() {
    const set = new Set()

    const layout = this.#cfg?.layout || {}
    const list = Array.isArray(layout?.ld2450) ? layout.ld2450 : []

    for (let radarId = 0; radarId < list.length; radarId += 1) {
      const entry = list[radarId]
      if (!entry) continue
      if (entry.enabled !== true) continue
      set.add(radarId)
    }

    return set
  }

  #makeEmptySanityCounters() {
    return {
      measWentBackwards: 0,
      negativeRecvLag: 0,
      recvLagHuge: 0,

      slotCountTooHigh: 0,
      detectionsGtSlots: 0,

      nonFiniteWorld: 0,

      last: {
        measWentBackwards: null,
        negativeRecvLag: null,
        recvLagHuge: null,
        slotCountTooHigh: null,
        detectionsGtSlots: null,
        nonFiniteWorld: null,
      },
    }
  }

  #noteSanity(counterKey, details) {
    if (!this.#sanityCounters[counterKey] && this.#sanityCounters[counterKey] !== 0) return

    this.#sanityCounters[counterKey] += 1
    this.#sanityCounters.last[counterKey] = {
      ts: this.#clock.nowMs(),
      ...details,
    }
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

    const prevLatest = this.#latestByRadarId.get(radarId)
    const prevMeasTs = Number(prevLatest?.measTs) || 0

    let measTs = measTsRaw
    if (prevMeasTs > 0 && measTsRaw < prevMeasTs) {
      this.#noteSanity('measWentBackwards', { radarId, measTs: measTsRaw, prevMeasTs })
      measTs = prevMeasTs + 1
    }

    const recvLagMs = Math.max(0, recvTs - measTs)
    if (recvTs < measTs) {
      this.#noteSanity('negativeRecvLag', { radarId, recvTs, measTs })
    }

    const hugeRecvLagMs = Number(this.#cfg?.tracking?.health?.recvLagHugeMs ?? 500)
    if (Number.isFinite(hugeRecvLagMs) && hugeRecvLagMs > 0 && recvLagMs > hugeRecvLagMs) {
      this.#noteSanity('recvLagHuge', { radarId, recvLagMs, hugeRecvLagMs })
    }

    const slotCountMax = Number(this.#cfg?.tracking?.health?.slotCountMax ?? 3)
    const slotCount = Number(p?.meta?.slotCount)
    if (Number.isFinite(slotCountMax) && slotCountMax > 0 && Number.isFinite(slotCount) && slotCount > slotCountMax) {
      this.#noteSanity('slotCountTooHigh', { radarId, slotCount, slotCountMax })
    }

    const detCountMeta = Number(p?.meta?.detectionCount)
    if (Number.isFinite(detCountMeta) && Number.isFinite(slotCount) && detCountMeta > slotCount) {
      this.#noteSanity('detectionsGtSlots', { radarId, detectionCount: detCountMeta, slotCount })
    }

    const tracks = Array.isArray(p.tracks) ? p.tracks : []
    const measurements = []

    for (const t of tracks) {
      const w = t?.world || {}
      const xMm = Number(w.xMm)
      const yMm = Number(w.yMm)

      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) {
        this.#noteSanity('nonFiniteWorld', { radarId })
        continue
      }

      const prov = this.#stripProvenanceForTracking(t?.provenance || null, { debugEnabled })

      measurements.push({
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
      measurements,
      detectionCount: measurements.length,
      slotCount: Number.isFinite(slotCount) ? slotCount : null,
    }

    const now = this.#clock.nowMs()
    this.#pushRadarBuffer(radarId, entry, now)

    // Keep "latest" for health/sanity/meta
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

    this.#latestByRadarId.set(radarId, entry)
    this.#radarsSeenEver.add(radarId)
  }

  #makeSnapshot(now) {
    const staleMeasMaxMs = this.#getStaleMeasMaxMs()
    const radarMissingTimeoutMs = this.#getRadarMissingTimeoutMs()

    const jitterDelayMs = this.#getJitterDelayMs()
    let sampleTs = now - jitterDelayMs

    const waitForAll = this.#getWaitForAllEnabled()
    const waitTimeoutMs = this.#getWaitForAllTimeoutMs()

    if (waitForAll) {
      // Align sampleTs to the slowest radar so we get a coherent multi-radar snapshot.
      // Bounded by waitTimeoutMs so we don't introduce large latency.
      let minLatest = Infinity
      let haveAny = false

      const expectedIds = this.#radarsExpectedSet.size > 0
        ? [...this.#radarsExpectedSet.values()]
        : [...this.#latestByRadarId.keys()]

      for (const rid of expectedIds) {
        const latest = this.#latestByRadarId.get(rid)
        const ts = Number(latest?.measTs)
        if (!Number.isFinite(ts) || ts <= 0) continue
        haveAny = true
        minLatest = Math.min(minLatest, ts)
      }

      if (haveAny && Number.isFinite(minLatest)) {
        const maxBack = now - waitTimeoutMs
        sampleTs = Math.max(minLatest, maxBack)
      }
    }

    const expected = this.#radarsExpectedSet
    const expectedCount = expected.size
    const seenTotal = this.#radarsSeenEver.size

    let radarsFresh = 0
    let radarsStale = 0
    let radarsMissing = 0

    let maxRadarAgeMs = 0
    let minRadarAgeMs = Infinity
    let maxRecvLagMs = 0

    let framesFreshWithDetections = 0
    let measIn = 0

    let snapshotsAdvancedThisTick = false
    let radarsAdvancedCount = 0

    const measurements = []
    const radars = []

    const debugEnabled = this.#debugEnabled()
    const debugRadars = debugEnabled ? [] : null

    const expectedIds = expectedCount > 0 ? [...expected.values()] : [...this.#latestByRadarId.keys()]
    const expectedSet = expectedCount > 0 ? expected : null

    for (const radarId of expectedIds) {
      const entry = this.#selectRadarEntry(radarId, sampleTs, now)

      if (!entry) {
        radarsMissing += 1

        radars.push({
          radarId,
          status: 'missing',
          included: false,
          advanced: false,
          measTs: null,
          recvTs: null,
          ageMs: null,
          recvLagMs: null,
          detectionCount: 0,
          slotCount: null,
          publishAs: null,
          zoneId: null,
        })

        if (debugEnabled) {
          debugRadars.push({
            radarId,
            publishAs: null,
            zoneId: null,
            enabled: expectedSet ? true : null,
            status: 'missing',
            included: false,
            advanced: false,
            measTs: null,
            ageMs: null,
            recvTs: null,
            recvLagMs: null,
            detectionCount: 0,
            slotCount: null,
            ingestDebug: null,
          })
        }

        continue
      }

      const measTs = Number(entry.measTs) || 0
      const recvTs = Number(entry.recvTs) || 0

      const ageMs = Math.max(0, now - measTs)
      const recvLagMs = (recvTs && measTs) ? Math.max(0, recvTs - measTs) : 0

      const lastTickMeasTs = Number(this.#lastTickMeasTsByRadarId.get(radarId)) || 0
      const advanced = measTs > lastTickMeasTs

      if (advanced) {
        snapshotsAdvancedThisTick = true
        radarsAdvancedCount += 1
      }

      let status = 'fresh'
      let included = true

      if (ageMs > radarMissingTimeoutMs) {
        status = 'missing'
        included = false
        radarsMissing += 1
      } else if (ageMs > staleMeasMaxMs) {
        status = 'stale'
        included = false
        radarsStale += 1
      } else {
        radarsFresh += 1
      }

      radars.push({
        radarId,
        status,
        included,
        advanced,
        measTs,
        recvTs: recvTs || null,
        ageMs,
        recvLagMs,
        detectionCount: Number(entry.detectionCount) || 0,
        slotCount: Number(entry.slotCount) || null,
        publishAs: entry.publishAs ?? null,
        zoneId: entry.zoneId ?? null,
      })

      if (included) {
        maxRadarAgeMs = Math.max(maxRadarAgeMs, ageMs)
        minRadarAgeMs = Math.min(minRadarAgeMs, ageMs)
        maxRecvLagMs = Math.max(maxRecvLagMs, recvLagMs)

        const detCount = Number(entry.detectionCount) || 0
        if (detCount > 0) framesFreshWithDetections += 1

        measIn += detCount
        if (Array.isArray(entry.measurements) && entry.measurements.length > 0) {
          measurements.push(...entry.measurements)
        }
      }

      if (debugEnabled) {
        debugRadars.push({
          radarId,
          publishAs: entry.publishAs ?? null,
          zoneId: entry.zoneId ?? null,
          enabled: expectedSet ? true : null,
          status,
          included,
          advanced,
          measTs,
          ageMs,
          recvTs: recvTs || null,
          recvLagMs,
          detectionCount: Number(entry.detectionCount) || 0,
          slotCount: Number(entry.slotCount) || null,
          ingestDebug: entry.debug?.ingestDebug ?? null,
        })
      }
    }

    if (!Number.isFinite(minRadarAgeMs)) minRadarAgeMs = 0

    for (const [radarId, entry] of this.#latestByRadarId.entries()) {
      const enabled = this.#radarsExpectedSet.size > 0 ? this.#radarsExpectedSet.has(radarId) : true
      if (!enabled) continue

      const measTs = Number(entry?.measTs) || 0
      const lastTickMeasTs = Number(this.#lastTickMeasTsByRadarId.get(radarId)) || 0
      if (measTs > lastTickMeasTs) {
        this.#lastTickMeasTsByRadarId.set(radarId, measTs)
      }
    }

    if (expectedCount > 0 && radarsAdvancedCount === 0) {
      this.#stuckTicks += 1
    } else {
      this.#stuckTicks = 0
    }

    const stuckN = Number(this.#cfg?.tracking?.snapshot?.stuckTicksWarn ?? 20)
    const stuck = Number.isFinite(stuckN) && stuckN > 0
      ? this.#stuckTicks >= stuckN
      : (this.#stuckTicks >= 20)

    const meta = {
      tickIntervalMs: this.#getUpdateIntervalMs(),
      staleMeasMaxMs,
      radarMissingTimeoutMs,

      jitterDelayMs,
      sampleTs,
      waitForAll: waitForAll || null,
      waitForAllTimeoutMs: waitForAll ? waitTimeoutMs : null,

      radarsExpected: expectedCount || null,
      radarsSeenTotal: seenTotal,

      radarsFresh,
      radarsStale,
      radarsMissing,

      framesFreshUsed: radarsFresh,
      framesFreshWithDetections,

      measIn,

      maxRadarAgeMs,
      minRadarAgeMs,
      maxRecvLagMs,

      snapshotsAdvancedThisTick,
      radarsAdvancedCount,

      stuckTicks: this.#stuckTicks,
      stuck,
    }

    const debug = debugEnabled ? { radars: debugRadars } : null

    return { measurements, radars, meta, debug }
  }

  #computeTickLagStats(now, measurements) {
    const lags = []

    for (const m of measurements) {
      const ts = Number(m?.measTs)
      if (!Number.isFinite(ts) || ts <= 0) continue
      lags.push(Math.max(0, now - ts))
    }

    if (lags.length === 0) {
      return { tickLagSamples: 0, tickLagMsMax: 0, tickLagMsP95: 0 }
    }

    lags.sort((a, b) => a - b)

    return {
      tickLagSamples: lags.length,
      tickLagMsMax: lags[lags.length - 1],
      tickLagMsP95: this.#percentileFromSorted(lags, 0.95),
    }
  }

  #percentileFromSorted(sortedAsc, p01) {
    if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return 0

    const p = Math.min(1, Math.max(0, Number(p01) || 0))
    const n = sortedAsc.length

    if (n === 1) return sortedAsc[0]

    const idx = Math.floor(p * (n - 1))
    return sortedAsc[Math.min(n - 1, Math.max(0, idx))]
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

  #findFallbackMeasIdxSameRadar(tr, measurements, unassignedSet, measVarMm2ByIdx) {
    const radarId = tr.lastRadarId
    if (radarId == null) return null

    const gateD2Max = Number(this.#cfg?.tracking?.association?.gateD2Max ?? 9.21)

    let bestIdx = null
    let bestD2 = Infinity

    for (const idx of unassignedSet) {
      const m = measurements[idx]
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

  #tick() {
    const now = this.#clock.nowMs()

    this.#cleanupJitterHistory(now)
    this.#cleanupJumpHistory(now)
    this.#cleanupRadarBuffers(now)

    const mode = this.#mode()
    const debugEnabled = this.#debugEnabled()

    const snapshot = this.#makeSnapshot(now)

    const rawMeasurements = snapshot.measurements
    const filtered = this.#filterMeasurements(rawMeasurements)
    const deduped = this.#dedupMeasurements(filtered)

    const measVarMm2ByIdx = this.#computeMeasVarByIdx(deduped, now)

    const fusion = this.#clusterMeasurements(deduped, measVarMm2ByIdx, now)
    const measurements = fusion.measurements
    const fusedVarMm2ByIdx = fusion.measVarMm2ByIdx

    const tickLag = this.#computeTickLagStats(now, measurements)

    this.#maybePublishSnapshotHealth(now, {
      snapshotMeta: snapshot.meta,
      snapshotRadars: snapshot.radars,
      tickLag,
      meas: {
        measIn: snapshot.meta.measIn,
        measFiltered: filtered.length,
        measDeduped: deduped.length,
        measFused: measurements.length,
      },
      fusionDebug: fusion.debug,
    })

    if (mode === 'passthrough') {
      this.#publishPassthrough(now, measurements, fusedVarMm2ByIdx, {
        debugEnabled,
        snapshotMeta: snapshot.meta,
        snapshotDebug: snapshot.debug,
        measFiltered: filtered.length,
        measDeduped: deduped.length,
        measFused: measurements.length,
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
      measurements,
      measVarMm2ByIdx: fusedVarMm2ByIdx,
    })

    const unassignedSet = new Set(unassignedMeas)

    for (const [trackId, measIdx] of assignments.entries()) {
      const tr = this.#tracksById.get(trackId)
      if (!tr) continue

      let m = measurements[measIdx]

      if (!this.#shouldAcceptRadarSwitch(tr, m)) {
        const fbIdx = this.#findFallbackMeasIdxSameRadar(tr, measurements, unassignedSet, fusedVarMm2ByIdx)

        if (fbIdx == null) {
          continue
        }

        unassignedSet.delete(fbIdx)
        m = measurements[fbIdx]
      }

      const varMm2 = Number(fusedVarMm2ByIdx[measIdx]) || 1
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
      const m = measurements[idx]
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

    const meta = {
      mode,

      ...snapshot.meta,

      measFiltered: filtered.length,
      measDeduped: deduped.length,
      measFused: measurements.length,

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

  #maybePublishSnapshotHealth(now, { snapshotMeta, snapshotRadars, tickLag, meas, fusionDebug }) {
    const intervalMs = this.#getHealthIntervalMs()
    if ((now - this.#healthLastPublishTs) < intervalMs) return

    this.#healthLastPublishTs = now
    this.#healthSeq += 1

    const expected = Number(snapshotMeta?.radarsExpected) || 0
    const fresh = Number(snapshotMeta?.radarsFresh) || 0
    const stale = Number(snapshotMeta?.radarsStale) || 0
    const missing = Number(snapshotMeta?.radarsMissing) || 0

    const degraded = (expected > 0 && fresh < expected && stale === 0 && missing === 0)

    const sanity = this.#buildSanityReport({
      now,
      snapshotMeta,
      degraded,
      tickLag,
    })

    const payload = {
      ts: now,
      seq: this.#healthSeq,

      overall: {
        tickIntervalMs: snapshotMeta?.tickIntervalMs ?? null,
        staleMeasMaxMs: snapshotMeta?.staleMeasMaxMs ?? null,
        radarMissingTimeoutMs: snapshotMeta?.radarMissingTimeoutMs ?? null,

        radarsExpected: snapshotMeta?.radarsExpected ?? null,
        radarsSeenTotal: snapshotMeta?.radarsSeenTotal ?? null,

        radarsFresh: snapshotMeta?.radarsFresh ?? null,
        radarsStale: snapshotMeta?.radarsStale ?? null,
        radarsMissing: snapshotMeta?.radarsMissing ?? null,

        maxRadarAgeMs: snapshotMeta?.maxRadarAgeMs ?? null,
        maxRecvLagMs: snapshotMeta?.maxRecvLagMs ?? null,

        snapshotsAdvancedThisTick: snapshotMeta?.snapshotsAdvancedThisTick ?? null,
        radarsAdvancedCount: snapshotMeta?.radarsAdvancedCount ?? null,

        stuckTicks: snapshotMeta?.stuckTicks ?? null,
        stuck: snapshotMeta?.stuck ?? null,

        tickLagSamples: tickLag?.tickLagSamples ?? 0,
        tickLagMsP95: tickLag?.tickLagMsP95 ?? 0,
        tickLagMsMax: tickLag?.tickLagMsMax ?? 0,

        degraded,
      },

      radars: Array.isArray(snapshotRadars) ? snapshotRadars : [],

      meas: {
        measIn: meas?.measIn ?? null,
        measFiltered: meas?.measFiltered ?? null,
        measDeduped: meas?.measDeduped ?? null,
        measFused: meas?.measFused ?? null,
      },

      fusion: fusionDebug || null,

      sanity,
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.trackingSnapshotHealth,
      ts: now,
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: domainEventTypes.presence.trackingSnapshotHealth,
        where: busIds.presenceInternal,
      }),
      payload,
    })

    this.#sanityCounters = this.#makeEmptySanityCounters()
  }

  #buildSanityReport({ snapshotMeta, degraded, tickLag }) {
    const errors = []
    const warnings = []
    const degradedList = []

    const expected = Number(snapshotMeta?.radarsExpected) || 0
    const fresh = Number(snapshotMeta?.radarsFresh) || 0
    const adv = Number(snapshotMeta?.radarsAdvancedCount) || 0

    if (degraded) {
      degradedList.push({ code: 'PARTIAL_SNAPSHOT', details: { fresh, expected } })
    }

    if (fresh > 0 && expected > 0 && adv === 0) {
      warnings.push({ code: 'NO_ADVANCE_WHILE_FRESH', details: { fresh, expected } })
    }

    const lagP95 = Number(tickLag?.tickLagMsP95) || 0
    const tickIntervalMs = Number(snapshotMeta?.tickIntervalMs) || 0
    const lagWarnMult = Number(this.#cfg?.tracking?.health?.tickLagWarnMult ?? 2)
    const lagWarnMs = (Number.isFinite(lagWarnMult) && lagWarnMult > 0 && tickIntervalMs > 0)
      ? (lagWarnMult * tickIntervalMs)
      : 0

    if (lagWarnMs > 0 && lagP95 > lagWarnMs) {
      warnings.push({ code: 'TICK_LAG_HIGH', details: { tickLagMsP95: lagP95, warnMs: lagWarnMs } })
    }

    if (this.#sanityCounters.negativeRecvLag > 0) {
      errors.push({ code: 'NEGATIVE_RECV_LAG', count: this.#sanityCounters.negativeRecvLag, last: this.#sanityCounters.last.negativeRecvLag })
    }

    if (this.#sanityCounters.measWentBackwards > 0) {
      errors.push({ code: 'MEAS_TS_WENT_BACKWARDS', count: this.#sanityCounters.measWentBackwards, last: this.#sanityCounters.last.measWentBackwards })
    }

    if (this.#sanityCounters.recvLagHuge > 0) {
      warnings.push({ code: 'RECV_LAG_HUGE', count: this.#sanityCounters.recvLagHuge, last: this.#sanityCounters.last.recvLagHuge })
    }

    if (this.#sanityCounters.slotCountTooHigh > 0) {
      warnings.push({ code: 'SLOTCOUNT_TOO_HIGH', count: this.#sanityCounters.slotCountTooHigh, last: this.#sanityCounters.last.slotCountTooHigh })
    }

    if (this.#sanityCounters.detectionsGtSlots > 0) {
      errors.push({ code: 'DETECTIONS_GT_SLOTS', count: this.#sanityCounters.detectionsGtSlots, last: this.#sanityCounters.last.detectionsGtSlots })
    }

    if (this.#sanityCounters.nonFiniteWorld > 0) {
      errors.push({ code: 'NONFINITE_WORLD_XY', count: this.#sanityCounters.nonFiniteWorld, last: this.#sanityCounters.last.nonFiniteWorld })
    }

    return {
      error: errors,
      warn: warnings,
      degraded: degradedList,
    }
  }

  #filterMeasurements(measurements) {
    const q = this.#cfg?.quality || {}
    const cutoffDeg = Number(q.edgeBearingCutoffDeg)

    const useBearingGate = Number.isFinite(cutoffDeg) && cutoffDeg > 0
    const cutoffAbs = useBearingGate ? Math.abs(cutoffDeg) : null

    if (!useBearingGate) return measurements

    const out = []
    for (const m of measurements) {
      const prov = m?.prov || null
      const local = prov?.localMm || null
      const x = Number(local?.xMm)
      const y = Number(local?.yMm)

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        out.push(m)
        continue
      }

      const bearingDeg = (Math.atan2(x, y) * 180) / Math.PI
      const absB = Math.abs(bearingDeg)

      if (absB > cutoffAbs) continue

      out.push(m)
    }

    return out
  }

  #publishPassthrough(now, measurements, measVarMm2ByIdx, { debugEnabled, snapshotMeta, snapshotDebug, measFiltered, measDeduped, measFused, tickLag, fusionDebug }) {
    const out = []

    for (let i = 0; i < measurements.length; i += 1) {
      const m = measurements[i]
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
        item.debug = this.#roundDebug(this.#buildDebug({
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

      measFiltered: Number(measFiltered) || measurements.length,
      measDeduped: Number(measDeduped) || measurements.length,
      measFused: Number(measFused) || measurements.length,

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

  #dedupMeasurements(measurements) {
    const latestByKey = new Map()

    for (const m of measurements) {
      const prov = m?.prov || null
      const publishAs = String(prov?.publishAs || '').trim()
      const slotId = Number(prov?.slotId)

      const key = publishAs && Number.isFinite(slotId)
        ? `${publishAs}:${slotId}`
        : `${Number(m?.radarId)}:${Number.isFinite(slotId) ? slotId : 'na'}`

      const ts = Number(m?.measTs) || 0
      const prev = latestByKey.get(key)
      if (!prev) {
        latestByKey.set(key, m)
        continue
      }

      const prevTs = Number(prev?.measTs) || 0
      if (ts >= prevTs) {
        latestByKey.set(key, m)
      }
    }

    return [...latestByKey.values()]
  }

  #jumpKeyForMeasurement(m) {
    const prov = m?.prov || null
    const publishAs = String(prov?.publishAs || '').trim()
    const slotId = Number(prov?.slotId)

    if (publishAs && Number.isFinite(slotId)) {
      return `slot:${publishAs}:${slotId}`
    }

    return `radar:${Number(m?.radarId)}`
  }

  #computeJumpScaleForKey({ key, ts, xMm, yMm, windowMs, suspiciousMmS, impossibleMmS, scaleMax }) {
    const k = String(key || '')
    if (!k) return 1

    const t = Number(ts)
    if (!Number.isFinite(t) || t <= 0) return 1

    const prev = this.#jumpLastByKey.get(k) || null
    this.#jumpLastByKey.set(k, { ts: t, xMm, yMm })

    if (!prev) return 1

    const dtMs = t - Number(prev.ts || 0)
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 1
    if (Number.isFinite(windowMs) && windowMs > 0 && dtMs > windowMs) return 1

    const dx = Number(xMm) - Number(prev.xMm)
    const dy = Number(yMm) - Number(prev.yMm)
    if (![dx, dy].every(Number.isFinite)) return 1

    const distMm = Math.sqrt((dx * dx) + (dy * dy))
    const speedMmS = distMm / (dtMs / 1000)

    const susp = Number(suspiciousMmS)
    const imp = Number(impossibleMmS)
    const sMax = Number(scaleMax)

    if (![speedMmS, susp, imp, sMax].every(Number.isFinite)) return 1
    if (sMax <= 1) return 1
    if (imp <= susp) return 1

    if (speedMmS <= susp) return 1
    if (speedMmS >= imp) return sMax

    const u = (speedMmS - susp) / (imp - susp)
    return lerp(1, sMax, u)
  }

  #cleanupJumpHistory(nowTs) {
    const windowMs = this.#getJitterWindowMs() // or make a dedicated getter if you want
    const ttlMs = windowMs * 2
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    for (const [key, v] of this.#jumpLastByKey.entries()) {
      const ts = Number(v?.ts)
      if (!Number.isFinite(ts) || (nowTs - ts) > ttlMs) {
        this.#jumpLastByKey.delete(key)
      }
    }
  }

  #computeMeasVarByIdx(measurements, now) {
    const baseMm = Number(this.#cfg?.tracking?.kf?.measNoiseBaseMm ?? 160)
    const baseVar = Math.max(1, baseMm * baseMm)

    const q = this.#cfg?.quality || {}

    const fullBear = Number(q.edgeBearingFullDeg ?? 30)
    const cutBear = Number(q.edgeBearingCutoffDeg ?? 45)
    const edgeMax = Number(q.edgeNoiseScaleMax ?? 4.0)

    const fullRange = Number(q.rangeFullMm ?? 1200)
    const cutRange = Number(q.rangeCutoffMm ?? 3000)
    const rangeMax = Number(q.rangeNoiseScaleMax ?? 3.0)

    const jitWinMs = Number(q.jitterWindowMs ?? 500)
    const jitFull = Number(q.jitterFullMm ?? 60)
    const jitCut = Number(q.jitterCutoffMm ?? 250)
    const jitMax = Number(q.jitterNoiseScaleMax ?? 3.0)

    const staleMaxMs = this.#getStaleMeasMaxMs()
    const staleMax = Number(q.staleNoiseScaleMax ?? 1)

    const useStaleScale = Number.isFinite(staleMax) && staleMax > 1 && Number.isFinite(staleMaxMs) && staleMaxMs > 0

    const out = Array(measurements.length).fill(baseVar)

    for (let i = 0; i < measurements.length; i += 1) {
      const m = measurements[i]
      const prov = m?.prov || null

      const local = prov?.localMm || null
      const lx = Number(local?.xMm)
      const ly = Number(local?.yMm)

      let bearingAbs = null
      let rangeMm = null

      if (Number.isFinite(lx) && Number.isFinite(ly)) {
        bearingAbs = Math.abs((Math.atan2(lx, ly) * 180) / Math.PI)
        rangeMm = Math.sqrt((lx * lx) + (ly * ly))
      }

      const bearingScale = (bearingAbs == null)
        ? 1
        : mapScale({ v: bearingAbs, full: fullBear, cutoff: cutBear, scaleMax: edgeMax })

      const rangeScale = (rangeMm == null)
        ? 1
        : mapScale({ v: rangeMm, full: fullRange, cutoff: cutRange, scaleMax: rangeMax })

      const key = this.#jitterKeyForMeasurement(m)

      const measTs = Number(m?.measTs)
      const ts = (Number.isFinite(measTs) && measTs > 0) ? measTs : now

      const jitterScale = this.#computeJitterScaleForKey({
        key,
        ts,
        xMm: m.xMm,
        yMm: m.yMm,
        windowMs: jitWinMs,
        fullMm: jitFull,
        cutoffMm: jitCut,
        scaleMax: jitMax,
      })

      let staleScale = 1
      if (useStaleScale) {
        const ageMs = Math.max(0, now - ts)
        const t = clamp01(ageMs / staleMaxMs)
        staleScale = lerp(1, staleMax, t)
      }

      const jumpKey = this.#jumpKeyForMeasurement(m)

      const jumpScale = this.#computeJumpScaleForKey({
        key: jumpKey,
        ts,
        xMm: m.xMm,
        yMm: m.yMm,
        windowMs: jitWinMs,
        suspiciousMmS: 3500,
        impossibleMmS: 8000,
        scaleMax: 10,
      })

      out[i] = baseVar * bearingScale * rangeScale * jitterScale * staleScale * jumpScale
    }

    return out
  }

  #jitterKeyForMeasurement(m) {
    const prov = m?.prov || null
    const publishAs = String(prov?.publishAs || '').trim()
    const slotId = Number(prov?.slotId)

    if (publishAs && Number.isFinite(slotId)) {
      return `slot:${publishAs}:${slotId}`
    }

    return `radar:${Number(m?.radarId)}`
  }

  #computeJitterScaleForKey({ key, ts, xMm, yMm, windowMs, fullMm, cutoffMm, scaleMax }) {
    const k = String(key || '')
    if (!k) return 1

    const t = Number(ts)
    if (!Number.isFinite(t) || t <= 0) return 1

    const prev = this.#jitterLastByKey.get(k) || null
    this.#jitterLastByKey.set(k, { ts: t, xMm, yMm })

    if (!prev) return 1

    const dt = t - Number(prev.ts || 0)
    if (!Number.isFinite(dt) || dt <= 0) return 1
    if (Number.isFinite(windowMs) && windowMs > 0 && dt > windowMs) return 1

    const dx = Number(xMm) - Number(prev.xMm)
    const dy = Number(yMm) - Number(prev.yMm)
    if (![dx, dy].every(Number.isFinite)) return 1

    const distMm = Math.sqrt((dx * dx) + (dy * dy))

    return mapScale({ v: distMm, full: fullMm, cutoff: cutoffMm, scaleMax })
  }

  #clusterMeasurements(measurements, measVarMm2ByIdx, now) {
    const enabled = this.#cfg?.tracking?.fusion?.enabled === true
    const debugEnabled = this.#debugEnabled()

    if (!enabled || measurements.length <= 1) {
      return {
        measurements,
        measVarMm2ByIdx,
        debug: {
          enabled,
          clustersOut: measurements.length,
          clustersMultiRadar: 0,
          clusterGateMm: Number(this.#cfg?.tracking?.fusion?.clusterGateMm ?? 450),
          clusterRadiusMmMax: 0,
          clusterRadiusMmP95: 0,
          mergesCrossRadar: 0,
          mergeRejectedNotVisible: 0,
        },
      }
    }

    const gateMm = Number(this.#cfg?.tracking?.fusion?.clusterGateMm ?? 450)
    const gate2 = Math.max(1, gateMm * gateMm)

    const maxClusterSize = Number(this.#cfg?.tracking?.fusion?.maxClusterSize ?? 10)
    const fovMarginDeg = Number(this.#cfg?.tracking?.fusion?.fovMarginDeg ?? 6)
    const rangeMarginMm = Number(this.#cfg?.tracking?.fusion?.rangeMarginMm ?? 150)

    const q = this.#cfg?.quality || {}
    const cutoffDeg = Number(q.edgeBearingCutoffDeg ?? 45)
    const rangeCutoffMm = Number(q.rangeCutoffMm ?? 3000)

    const fovDeg = Number(this.#cfg?.layout?.radarFovDeg ?? 120)
    const halfFov = Number.isFinite(fovDeg) ? Math.abs(fovDeg) / 2 : 60

    const bearingAbsMax = Math.min(
      Number.isFinite(cutoffDeg) ? Math.abs(cutoffDeg) : 180,
      Number.isFinite(halfFov) ? halfFov : 180,
    ) + (Number.isFinite(fovMarginDeg) ? Math.abs(fovMarginDeg) : 0)

    const rangeMax = (Number.isFinite(rangeCutoffMm) ? rangeCutoffMm : 3000) + (Number.isFinite(rangeMarginMm) ? Math.abs(rangeMarginMm) : 0)

    const n = measurements.length
    const uf = new Uf(n)

    let mergesCrossRadar = 0
    let mergeRejectedNotVisible = 0

    const isVisible = (radarId, wx, wy) => {
      const loc = this.#transform.toLocalMm({ radarId, xMm: wx, yMm: wy })
      const x = Number(loc?.xMm)
      const y = Number(loc?.yMm)

      if (!Number.isFinite(x) || !Number.isFinite(y)) return false

      const bearingDeg = (Math.atan2(x, y) * 180) / Math.PI
      const absB = Math.abs(bearingDeg)

      if (absB > bearingAbsMax) return false

      const r = Math.sqrt((x * x) + (y * y))
      if (!Number.isFinite(r)) return false
      if (r > rangeMax) return false

      return true
    }

    for (let i = 0; i < n; i += 1) {
      const a = measurements[i]

      for (let j = i + 1; j < n; j += 1) {
        const b = measurements[j]

        const dx = a.xMm - b.xMm
        const dy = a.yMm - b.yMm
        const d2 = (dx * dx) + (dy * dy)

        if (d2 > gate2) continue

        if (a.radarId === b.radarId) {
          uf.union(i, j)
          continue
        }

        const cx = (a.xMm + b.xMm) / 2
        const cy = (a.yMm + b.yMm) / 2

        const visA = isVisible(a.radarId, cx, cy)
        const visB = isVisible(b.radarId, cx, cy)

        if (visA && visB) {
          mergesCrossRadar += 1
          uf.union(i, j)
          continue
        }

        mergeRejectedNotVisible += 1
      }
    }

    const groups = new Map()
    for (let i = 0; i < n; i += 1) {
      const r = uf.find(i)

      if (!groups.has(r)) groups.set(r, [])
      groups.get(r).push(i)
    }

    const fused = []
    const fusedVar = []

    const clusterRadius = []
    let clustersMultiRadar = 0

    for (const idxs of groups.values()) {
      if (idxs.length === 1) {
        const i = idxs[0]
        fused.push(measurements[i])
        fusedVar.push(Number(measVarMm2ByIdx[i]) || 1)
        clusterRadius.push(0)
        continue
      }

      if (Number.isFinite(maxClusterSize) && maxClusterSize > 0 && idxs.length > maxClusterSize) {
        for (const i of idxs) {
          fused.push(measurements[i])
          fusedVar.push(Number(measVarMm2ByIdx[i]) || 1)
          clusterRadius.push(0)
        }

        continue
      }

      let sumW = 0
      let sumX = 0
      let sumY = 0
      let tsMax = 0

      const radarSet = new Set()
      const zoneSet = new Set()

      const members = debugEnabled ? [] : null

      let bestIdx = idxs[0]
      let bestVar = Infinity

      for (const i of idxs) {
        const m = measurements[i]
        const varMm2 = Number(measVarMm2ByIdx[i]) || 1
        const w = 1 / Math.max(1, varMm2)

        sumW += w
        sumX += w * m.xMm
        sumY += w * m.yMm

        tsMax = Math.max(tsMax, Number(m.measTs) || 0)

        radarSet.add(m.radarId)
        if (m.zoneId) zoneSet.add(m.zoneId)

        if (varMm2 < bestVar) {
          bestVar = varMm2
          bestIdx = i
        }

        if (debugEnabled) {
          members.push({
            radarId: m.radarId,
            zoneId: m.zoneId,
            xMm: m.xMm,
            yMm: m.yMm,
            measTs: m.measTs,
            varMm2,
          })
        }
      }

      const cx = sumW > 0 ? (sumX / sumW) : measurements[bestIdx].xMm
      const cy = sumW > 0 ? (sumY / sumW) : measurements[bestIdx].yMm

      let rMax = 0
      for (const i of idxs) {
        const m = measurements[i]
        const dx = m.xMm - cx
        const dy = m.yMm - cy
        const d = Math.sqrt((dx * dx) + (dy * dy))
        if (Number.isFinite(d)) rMax = Math.max(rMax, d)
      }

      clusterRadius.push(rMax)

      if (radarSet.size > 1) clustersMultiRadar += 1

      const rep = measurements[bestIdx]
      const repProv = rep?.prov || null

      const fusedItem = {
        measTs: tsMax || rep.measTs,
        radarId: rep.radarId,
        zoneId: zoneSet.size === 1 ? [...zoneSet][0] : rep.zoneId,

        xMm: cx,
        yMm: cy,

        sourceRadars: [...radarSet],

        prov: repProv,
      }

      if (debugEnabled) {
        fusedItem.fusion = {
          members,
          membersCount: idxs.length,
          radiusMm: rMax,
        }
      }

      fused.push(fusedItem)

      const fusedVarMm2 = sumW > 0 ? (1 / sumW) : (Number(measVarMm2ByIdx[bestIdx]) || 1)
      fusedVar.push(fusedVarMm2)
    }

    clusterRadius.sort((a, b) => a - b)

    const radiusMax = clusterRadius.length > 0 ? clusterRadius[clusterRadius.length - 1] : 0
    const radiusP95 = clusterRadius.length > 0 ? this.#percentileFromSorted(clusterRadius, 0.95) : 0

    return {
      measurements: fused,
      measVarMm2ByIdx: fusedVar,
      debug: {
        enabled,
        clustersOut: fused.length,
        clustersMultiRadar,
        clusterGateMm: gateMm,
        clusterRadiusMmMax: radiusMax,
        clusterRadiusMmP95: radiusP95,
        mergesCrossRadar,
        mergeRejectedNotVisible,
      },
    }
  }

  #getJitterWindowMs() {
    const q = this.#cfg?.quality || {}
    const ms = Number(q.jitterWindowMs ?? 500)
    return (Number.isFinite(ms) && ms > 0) ? Math.floor(ms) : 500
  }

  #cleanupJitterHistory(nowTs) {
    const windowMs = this.#getJitterWindowMs()
    const ttlMs = windowMs * 2

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    for (const [key, v] of this.#jitterLastByKey.entries()) {
      const ts = Number(v?.ts)
      if (!Number.isFinite(ts)) {
        this.#jitterLastByKey.delete(key)
        continue
      }

      if ((nowTs - ts) > ttlMs) {
        this.#jitterLastByKey.delete(key)
      }
    }
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
      measTs: Number.isFinite(Number(prov.measTs)) ? Number(prov.measTs) : m.measTs,

      localMm: prov.localMm ?? null,
      worldMeasMm: prov.worldMeasMm ?? { xMm: m.xMm, yMm: m.yMm },

      frame: prov.frame ?? null,
    } : {
      bus: 'presence',
      publishAs: null,
      radarId: m.radarId,
      slotId: null,
      measTs: m.measTs,

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
