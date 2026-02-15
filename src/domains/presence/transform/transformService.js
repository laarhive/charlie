// src/domains/presence/transform/transformService.js
export class TransformService {
  #logger

  #azimuthDeg
  #yawOffsetsDeg
  #tubeRadiusMm

  #cosTheta
  #sinTheta
  #tx
  #ty

  constructor({ config, logger }) {
    this.#logger = logger

    const layout = config?.layout || {}
    const az = Array.isArray(layout?.radarAzimuthDeg) ? layout.radarAzimuthDeg : []

    this.#azimuthDeg = az.map((x) => Number(x) || 0)

    const tubeDiameterMm = Number(layout?.tubeDiameterMm)
    this.#tubeRadiusMm = Number.isFinite(tubeDiameterMm) && tubeDiameterMm > 0
      ? tubeDiameterMm / 2
      : 50

    this.#yawOffsetsDeg = this.#initYawOffsets(config)

    this.#cosTheta = []
    this.#sinTheta = []
    this.#tx = []
    this.#ty = []

    this.#rebuildCache()
  }

  toWorldMm({ radarId, xMm, yMm }) {
    const i = Number(radarId)
    if (!Number.isFinite(i) || i < 0 || i >= this.#azimuthDeg.length) {
      return { xMm: 0, yMm: 0 }
    }

    const cosT = this.#cosTheta[i]
    const sinT = this.#sinTheta[i]
    const tx = this.#tx[i]
    const ty = this.#ty[i]

    const X = (cosT * yMm) + (-sinT * xMm) + tx
    const Y = (sinT * yMm) + (cosT * xMm) + ty

    return { xMm: X, yMm: Y }
  }

  toLocalMm({ radarId, xMm, yMm }) {
    const i = Number(radarId)
    if (!Number.isFinite(i) || i < 0 || i >= this.#azimuthDeg.length) {
      return { xMm: 0, yMm: 0 }
    }

    const cosT = this.#cosTheta[i]
    const sinT = this.#sinTheta[i]
    const tx = this.#tx[i]
    const ty = this.#ty[i]

    const Xp = Number(xMm) - tx
    const Yp = Number(yMm) - ty

    const yLocal = (cosT * Xp) + (sinT * Yp)
    const xLocal = (-sinT * Xp) + (cosT * Yp)

    return { xMm: xLocal, yMm: yLocal }
  }

  /* Debug helper: world -> local -> world round-trip error for a single point */
  validateRoundTripWorldMm({ radarId, xMm, yMm }) {
    const wx = Number(xMm)
    const wy = Number(yMm)
    if (![wx, wy].every(Number.isFinite)) {
      return { ok: false, errMm: null, w0: { xMm: wx, yMm: wy }, w1: null }
    }

    const local = this.toLocalMm({ radarId, xMm: wx, yMm: wy })
    const world = this.toWorldMm({ radarId, xMm: local.xMm, yMm: local.yMm })

    const dx = Number(world.xMm) - wx
    const dy = Number(world.yMm) - wy
    const errMm = Math.sqrt((dx * dx) + (dy * dy))

    return {
      ok: Number.isFinite(errMm),
      errMm,
      w0: { xMm: wx, yMm: wy },
      w1: world,
    }
  }

  getYawOffsetsDeg() {
    return [...this.#yawOffsetsDeg]
  }

  getDebugForRadar(radarId) {
    const i = Number(radarId)
    if (!Number.isFinite(i) || i < 0 || i >= this.#azimuthDeg.length) return null

    const phiDeg = this.#azimuthDeg[i]
    const deltaDeg = this.#yawOffsetsDeg[i] || 0

    return {
      phiDeg,
      deltaDeg,
      tubeRadiusMm: this.#tubeRadiusMm,
      cache: {
        cosTheta: this.#cosTheta[i],
        sinTheta: this.#sinTheta[i],
        tx: this.#tx[i],
        ty: this.#ty[i],
      },
    }
  }

  #rebuildCache() {
    const n = this.#azimuthDeg.length

    this.#cosTheta = Array(n).fill(1)
    this.#sinTheta = Array(n).fill(0)
    this.#tx = Array(n).fill(0)
    this.#ty = Array(n).fill(0)

    for (let i = 0; i < n; i += 1) {
      const phiDeg = Number(this.#azimuthDeg[i]) || 0
      const deltaDeg = Number(this.#yawOffsetsDeg[i]) || 0
      const thetaDeg = phiDeg + deltaDeg

      const thetaRad = (thetaDeg * Math.PI) / 180
      this.#cosTheta[i] = Math.cos(thetaRad)
      this.#sinTheta[i] = Math.sin(thetaRad)

      const phiRad = (phiDeg * Math.PI) / 180
      this.#tx[i] = this.#tubeRadiusMm * Math.cos(phiRad)
      this.#ty[i] = this.#tubeRadiusMm * Math.sin(phiRad)
    }
  }

  #initYawOffsets(config) {
    const n = this.#azimuthDeg.length
    const arr = Array(n).fill(0)

    const override = config?.extrinsics?.yawOffsetsDeg
    if (Array.isArray(override) && override.length === n) {
      for (let i = 0; i < n; i += 1) {
        arr[i] = Number(override[i]) || 0
      }

      arr[0] = 0
      return arr
    }

    arr[0] = 0
    return arr
  }
}

export default TransformService
