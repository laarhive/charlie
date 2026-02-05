export class KalmanFilterCv2d {
  #q
  #rBase

  constructor({ procNoiseAccelMmS2, measNoiseBaseMm }) {
    this.#q = Number(procNoiseAccelMmS2) || 1200
    this.#rBase = Number(measNoiseBaseMm) || 160
  }

  createInitial({ xMm, yMm, initialPosVarMm2, initialVelVarMm2S2 }) {
    const x = [xMm, yMm, 0, 0]

    const pPos = Number(initialPosVarMm2) || 250000
    const pVel = Number(initialVelVarMm2S2) || 1440000

    const P = [
      [pPos, 0,    0,    0],
      [0,    pPos, 0,    0],
      [0,    0,    pVel, 0],
      [0,    0,    0,    pVel],
    ]

    return { x, P }
  }

  predict(state, dtSec) {
    const dt = Math.max(0, Number(dtSec) || 0)

    if (dt <= 0) {
      return state
    }

    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1,  0],
      [0, 0, 0,  1],
    ]

    const q = this.#q
    const dt2 = dt * dt
    const dt3 = dt2 * dt
    const dt4 = dt2 * dt2

    const q2 = q * q

    const Q = [
      [q2 * (dt4 / 4), 0,               q2 * (dt3 / 2), 0],
      [0,              q2 * (dt4 / 4),  0,              q2 * (dt3 / 2)],
      [q2 * (dt3 / 2), 0,               q2 * dt2,        0],
      [0,              q2 * (dt3 / 2),  0,              q2 * dt2],
    ]

    const xPred = mulMatVec(F, state.x)
    const PPred = addMat(mulMat(mulMat(F, state.P), transpose(F)), Q)

    return { x: xPred, P: PPred }
  }

  update(state, z, measSigmaMm) {
    const res = this.updateWithDebug(state, z, measSigmaMm)
    return res.state
  }

  updateWithDebug(state, z, measSigmaMm) {
    const zx = Number(z?.xMm) || 0
    const zy = Number(z?.yMm) || 0

    const sigma = Number(measSigmaMm) || this.#rBase
    const r = sigma * sigma

    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]

    const R = [
      [r, 0],
      [0, r],
    ]

    const x = state.x
    const P = state.P

    const zVec = [zx, zy]
    const y = subVec(zVec, mulMatVec(H, x))

    const S = addMat(mulMat(mulMat(H, P), transpose(H)), R)
    const SInv = inv2(S)
    if (!SInv) {
      return {
        state,
        innovationMm: { dx: 0, dy: 0 },
        sigmaMm: sigma,
      }
    }

    const K = mulMat(mulMat(P, transpose(H)), SInv)

    const xNew = addVec(x, mulMatVec(K, y))
    const I = ident4()
    const KH = mulMat(K, H)
    const PNew = mulMat(subMat(I, KH), P)

    return {
      state: { x: xNew, P: PNew },
      innovationMm: { dx: y[0], dy: y[1] },
      sigmaMm: sigma,
    }
  }
}

const mulMat = function mulMat(A, B) {
  const r = A.length
  const c = B[0].length
  const k = B.length

  const out = Array.from({ length: r }, () => Array(c).fill(0))

  for (let i = 0; i < r; i += 1) {
    for (let j = 0; j < c; j += 1) {
      let s = 0
      for (let t = 0; t < k; t += 1) {
        s += A[i][t] * B[t][j]
      }

      out[i][j] = s
    }
  }

  return out
}

const mulMatVec = function mulMatVec(A, v) {
  const r = A.length
  const c = A[0].length
  const out = Array(r).fill(0)

  for (let i = 0; i < r; i += 1) {
    let s = 0
    for (let j = 0; j < c; j += 1) {
      s += A[i][j] * v[j]
    }

    out[i] = s
  }

  return out
}

const transpose = function transpose(A) {
  const r = A.length
  const c = A[0].length
  const out = Array.from({ length: c }, () => Array(r).fill(0))

  for (let i = 0; i < r; i += 1) {
    for (let j = 0; j < c; j += 1) {
      out[j][i] = A[i][j]
    }
  }

  return out
}

const addMat = function addMat(A, B) {
  const r = A.length
  const c = A[0].length
  const out = Array.from({ length: r }, () => Array(c).fill(0))

  for (let i = 0; i < r; i += 1) {
    for (let j = 0; j < c; j += 1) {
      out[i][j] = A[i][j] + B[i][j]
    }
  }

  return out
}

const subMat = function subMat(A, B) {
  const r = A.length
  const c = A[0].length
  const out = Array.from({ length: r }, () => Array(c).fill(0))

  for (let i = 0; i < r; i += 1) {
    for (let j = 0; j < c; j += 1) {
      out[i][j] = A[i][j] - B[i][j]
    }
  }

  return out
}

const addVec = function addVec(a, b) {
  return a.map((x, i) => x + b[i])
}

const subVec = function subVec(a, b) {
  return a.map((x, i) => x - b[i])
}

const ident4 = function ident4() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

const inv2 = function inv2(M) {
  const a = M[0][0]
  const b = M[0][1]
  const c = M[1][0]
  const d = M[1][1]

  const det = (a * d) - (b * c)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return null
  }

  const invDet = 1 / det

  return [
    [ d * invDet, -b * invDet],
    [-c * invDet,  a * invDet],
  ]
}

