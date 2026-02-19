// public/dev/radar-planner/ring-definitions.js

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const makeCosineRing = function makeCosineRing({ frontCm, backCm, p }) {
  const params = {
    frontCm: Number(frontCm),
    backCm: Number(backCm),
    p: clamp(Number(p), 0.6, 6)
  }

  const radius = function radius(thetaRad) {
    const c = Math.cos(thetaRad)
    const base = (1 + c) / 2
    const f = Math.pow(base, params.p)

    if (!Number.isFinite(params.frontCm) || !Number.isFinite(params.backCm)) return 0

    return params.backCm + ((params.frontCm - params.backCm) * f)
  }

  return { kind: "cosine", radius }
}

const RINGS = {
  monitor: makeCosineRing({ frontCm: 600, backCm: 350, p: 1.4 }),
  arm: makeCosineRing({ frontCm: 450, backCm: 250, p: 1.6 }),
  speak: makeCosineRing({ frontCm: 300, backCm: 40, p: 3.0 })
}

export { RINGS }
