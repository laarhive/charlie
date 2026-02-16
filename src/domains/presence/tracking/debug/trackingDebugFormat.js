// src/domains/presence/tracking/debug/trackingDebugFormat.js

const clamp01 = function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

const lerp = function lerp(a, b, t) {
  return (a + (b - a) * clamp01(t))
}

export const buildDebug = function buildDebug({ mode, updatedThisTick, m, assoc, kf }) {
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

export const roundDebug = function roundDebug(debug) {
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
    updateApplied: typeof debug.kf.updateApplied === 'boolean' ? debug.kf.updateApplied : null,
    skipReason: debug.kf.skipReason ?? null,
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

export const mapScale = function mapScale({ v, full, cutoff, scaleMax }) {
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
