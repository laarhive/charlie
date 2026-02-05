// src/domains/presence/transform/transformService.js
export class TransformService {
  #logger
  #azimuthDeg
  #yawOffsetsDeg
  #tubeRadiusMm

  constructor({ config, logger }) {
    this.#logger = logger

    const layout = config?.layout || {}
    const az = Array.isArray(layout?.radarAzimuthDeg) ? layout.radarAzimuthDeg : []

    this.#azimuthDeg = az.map((x) => Number(x) || 0)

    this.#tubeRadiusMm = 50

    this.#yawOffsetsDeg = this.#initYawOffsets(config)
  }

  toWorldMm({ radarId, xMm, yMm }) {
    const i = Number(radarId)
    if (!Number.isFinite(i) || i < 0 || i >= this.#azimuthDeg.length) {
      return { xMm: 0, yMm: 0 }
    }

    const phiDeg = this.#azimuthDeg[i]
    const deltaDeg = this.#yawOffsetsDeg[i] || 0
    const thetaDeg = phiDeg + deltaDeg

    const thetaRad = (thetaDeg * Math.PI) / 180
    const cosT = Math.cos(thetaRad)
    const sinT = Math.sin(thetaRad)

    const phiRad = (phiDeg * Math.PI) / 180
    const tx = this.#tubeRadiusMm * Math.cos(phiRad)
    const ty = this.#tubeRadiusMm * Math.sin(phiRad)

    const X = (cosT * yMm) + (-sinT * xMm) + tx
    const Y = (sinT * yMm) + ( cosT * xMm) + ty

    return { xMm: X, yMm: Y }
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
