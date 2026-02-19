// public/dev/radar-planner/ring-definitions.js

/**
 * ===============================================================
 * ENGAGEMENT RING DEFINITIONS
 * ===============================================================
 *
 * Purpose
 * -------
 * Defines Charlie's engagement zones:
 *
 *   - monitor → outer awareness zone
 *   - arm     → physical interaction reach zone
 *   - speak   → close conversation zone
 *
 * Units
 * -----
 * All dimensions are in centimeters (cm).
 * Every ring model MUST return radius in cm.
 *
 * ---------------------------------------------------------------
 * RING MODEL CONTRACT
 * ---------------------------------------------------------------
 *
 * A ring is defined in Charlie-local polar space.
 *
 * thetaRad (radians):
 *   0        = front (Charlie forward)
 *   π/2      = left
 *   π        = back
 *   3π/2     = right
 *   (standard CCW math orientation)
 *
 * A valid ring model must implement:
 *
 *   {
 *     radius(thetaRad: number): number
 *   }
 *
 * - thetaRad is in radians
 * - return value is radius in cm
 * - must work for thetaRad in [0, 2π]
 *
 * This file contains math only.
 * No world rotation.
 * No rendering logic.
 */

/**
 * @typedef {Object} RingModel
 * @property {(thetaRad: number) => number} radius
 */

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

/**
 * Engagement ring models.
 *
 * Keys must match those used in engagement-layer.js.
 *
 * @type {{
 *   monitor: RingModel,
 *   arm: RingModel,
 *   speak: RingModel
 * }}
 */
const RINGS = {
  monitor: makeCosineRing({ frontCm: 600, backCm: 350, p: 1.4 }),
  arm: makeCosineRing({ frontCm: 450, backCm: 250, p: 1.6 }),
  speak: makeCosineRing({ frontCm: 300, backCm: 40, p: 3.0 })
}

export { RINGS }
