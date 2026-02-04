// src/domains/presence/transformService.js
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

    // Tube is fixed in spec; keep here but allow override later if you want
    this.#tubeRadiusMm = 55

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

    // t_i = R * [cos(phi), sin(phi)] in world frame (+X North, +Y East)
    const phiRad = (phiDeg * Math.PI) / 180
    const tx = this.#tubeRadiusMm * Math.cos(phiRad)
    const ty = this.#tubeRadiusMm * Math.sin(phiRad)

    // Rotate radar-local into world, then translate by radar position on tube
    // world = R(theta) * [x,y] + t
    const X = (cosT * xMm) - (sinT * yMm) + tx
    const Y = (sinT * xMm) + (cosT * yMm) + ty

    return { xMm: X, yMm: Y }
  }

  getYawOffsetsDeg() {
    return [...this.#yawOffsetsDeg]
  }

  #initYawOffsets(config) {
    const n = this.#azimuthDeg.length
    const arr = Array(n).fill(0)

    const override = config?.extrinsics?.yawOffsetsDeg
    if (Array.isArray(override) && override.length === n) {
      for (let i = 0; i < n; i += 1) {
        arr[i] = Number(override[i]) || 0
      }

      // spec: δ0 fixed to 0
      arr[0] = 0
      return arr
    }

    // null => persistence later, default safe zeros now
    arr[0] = 0
    return arr
  }
}

export default TransformService
