// public/debug/presence/transform.js
export class TransformService {
  #azimuthDeg
  #yawOffsetsDeg
  #tubeRadiusMm

  constructor({ layout }) {
    const az = Array.isArray(layout?.radarAzimuthDeg) ? layout.radarAzimuthDeg : []
    this.#azimuthDeg = az.map((x) => Number(x) || 0)

    const tubeD = Number(layout?.tubeDiameterMm)
    this.#tubeRadiusMm = Number.isFinite(tubeD) && tubeD > 0 ? tubeD / 2 : 50

    const n = this.#azimuthDeg.length
    const yaw = Array.isArray(layout?.yawOffsetsDeg) ? layout.yawOffsetsDeg : null
    this.#yawOffsetsDeg = Array(n).fill(0)

    if (yaw && yaw.length === n) {
      for (let i = 0; i < n; i += 1) {
        this.#yawOffsetsDeg[i] = Number(yaw[i]) || 0
      }
    }

    if (n > 0) this.#yawOffsetsDeg[0] = 0
  }

  /**
   * LD2450 local convention assumed:
   * - xMm: right (+) / left (-)
   * - yMm: forward (+)
   *
   * World (Charlie) convention:
   * - X: North (+)
   * - Y: East (+)
   */
  toWorldMm({ radarId, xMm, yMm }) {
    const i = Number(radarId)
    if (!Number.isFinite(i) || i < 0 || i >= this.#azimuthDeg.length) {
      return { xMm: 0, yMm: 0 }
    }

    const phiDeg = this.#azimuthDeg[i]
    const deltaDeg = this.#yawOffsetsDeg[i] || 0
    const thetaDeg = phiDeg + deltaDeg

    const phiRad = (phiDeg * Math.PI) / 180
    const thetaRad = (thetaDeg * Math.PI) / 180

    const cosT = Math.cos(thetaRad)
    const sinT = Math.sin(thetaRad)

    // Radar position on tube uses nominal phi (per spec)
    const tx = this.#tubeRadiusMm * Math.cos(phiRad)
    const ty = this.#tubeRadiusMm * Math.sin(phiRad)

    const x = Number(xMm) || 0
    const y = Number(yMm) || 0

    // Convert local (x right, y forward) into world (X north, Y east)
    // world = y * fwd(theta) + x * right(theta) + t
    // fwd(theta) = [cosT, sinT]
    // right(theta) = [-sinT, cosT]
    const X = (y * cosT) - (x * sinT) + tx
    const Y = (y * sinT) + (x * cosT) + ty

    return { xMm: X, yMm: Y }
  }

  getTubeRadiusMm() {
    return this.#tubeRadiusMm
  }
}

export default TransformService
