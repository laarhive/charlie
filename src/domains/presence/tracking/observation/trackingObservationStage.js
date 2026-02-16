// src/domains/presence/tracking/observation/trackingObservationStage.js

import { mapScale } from '../debug/trackingDebugFormat.js'

const clamp01 = function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

const lerp = function lerp(a, b, t) {
  return (a + (b - a) * clamp01(t))
}

export class TrackingObservationStage {
  #cfg

  #jitterLastByKey = new Map()
  #jumpLastByKey = new Map()

  constructor({ cfg }) {
    this.#cfg = cfg || {}
  }

  dispose() {
    this.#jitterLastByKey.clear()
    this.#jumpLastByKey.clear()
  }

  cleanup(now) {
    this.#cleanupHistory(now)
  }

  process({ observations, now }) {
    const raw = Array.isArray(observations) ? observations : []
    const filtered = this.#filterObservations(raw)
    const deduped = this.#dedupObservations(filtered)
    const measVarMm2ByIdx = this.#computeMeasVarByIdx(deduped, now)

    return { filtered, deduped, measVarMm2ByIdx }
  }

  #filterObservations(observations) {
    const q = this.#cfg?.quality || {}
    const cutoffDeg = Number(q.edgeBearingCutoffDeg)

    const useBearingGate = Number.isFinite(cutoffDeg) && cutoffDeg > 0
    const cutoffAbs = useBearingGate ? Math.abs(cutoffDeg) : null

    if (!useBearingGate) return observations

    const out = []
    for (const m of observations) {
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

  #dedupObservations(observations) {
    const latestByKey = new Map()

    for (const m of observations) {
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

  #computeMeasVarByIdx(observations, now) {
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

    const out = Array(observations.length).fill(baseVar)

    for (let i = 0; i < observations.length; i += 1) {
      const m = observations[i]
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

      const measTs = Number(m?.measTs)
      const ts = (Number.isFinite(measTs) && measTs > 0) ? measTs : now

      const jitterKey = this.#slotOrRadarKey(m)
      const jitterScale = this.#computeJitterScaleForKey({
        key: jitterKey,
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

      const jumpScale = this.#computeJumpScaleForKey({
        key: jitterKey,
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

  #slotOrRadarKey(m) {
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

  #cleanupHistory(nowTs) {
    const windowMs = this.#getJitterWindowMs()
    const ttlMs = windowMs * 2
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    for (const [key, v] of this.#jitterLastByKey.entries()) {
      const ts = Number(v?.ts)
      if (!Number.isFinite(ts) || (nowTs - ts) > ttlMs) {
        this.#jitterLastByKey.delete(key)
      }
    }

    for (const [key, v] of this.#jumpLastByKey.entries()) {
      const ts = Number(v?.ts)
      if (!Number.isFinite(ts) || (nowTs - ts) > ttlMs) {
        this.#jumpLastByKey.delete(key)
      }
    }
  }

  #getJitterWindowMs() {
    const q = this.#cfg?.quality || {}
    const ms = Number(q.jitterWindowMs ?? 500)
    return (Number.isFinite(ms) && ms > 0) ? Math.floor(ms) : 500
  }

  #getStaleMeasMaxMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.staleMeasMaxMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 250
  }
}

export default TrackingObservationStage
