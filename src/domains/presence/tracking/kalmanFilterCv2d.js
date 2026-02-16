export class KalmanFilterCv2d {
  #qa
  #rBase

  constructor({ procNoiseAccelMmS2, measNoiseBaseMm }) {
    const sigmaARaw = Number(procNoiseAccelMmS2)
    const sigmaA = Number.isFinite(sigmaARaw) ? Math.max(0, sigmaARaw) : 1200
    this.#qa = sigmaA * sigmaA
    this.#rBase = Math.max(1, Number(measNoiseBaseMm) || 160)
  }

  createInitial({ xMm, yMm, initialPosVarMm2, initialVelVarMm2S2 }) {
    const x = [sanitizeFinite(xMm, 0), sanitizeFinite(yMm, 0), 0, 0]

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
    const s = cloneState(state)
    const dt = Math.max(0, Number(dtSec) || 0)

    if (dt <= 0) {
      return s
    }

    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1,  0],
      [0, 0, 0,  1],
    ]

    const qa = this.#qa
    const dt2 = dt * dt
    const dt3 = dt2 * dt
    const dt4 = dt2 * dt2

    const Q = [
      [qa * (dt4 / 4), 0,               qa * (dt3 / 2), 0],
      [0,              qa * (dt4 / 4),  0,              qa * (dt3 / 2)],
      [qa * (dt3 / 2), 0,               qa * dt2,        0],
      [0,              qa * (dt3 / 2),  0,               qa * dt2],
    ]

    const xPred = mulMatVec(F, s.x)
    const PPred = symmetrize4(addMat(mulMat(mulMat(F, s.P), transpose(F)), Q))

    return { x: xPred, P: PPred }
  }

  update(state, z, measSigmaMm) {
    const res = this.updateWithDebug(state, z, measSigmaMm)
    return res.state
  }

  updateWithDebug(state, z, measSigmaMm) {
    const s = cloneState(state)
    const zx = Number(z?.xMm)
    const zy = Number(z?.yMm)

    const sigma = Math.max(1, Number(measSigmaMm) || this.#rBase)
    const r = sigma * sigma

    if (!Number.isFinite(zx) || !Number.isFinite(zy)) {
      return {
        state: s,
        innovationMm: null,
        sigmaMm: sigma,
        updateApplied: false,
        skipReason: 'invalid_measurement',
      }
    }

    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]

    const R = [
      [r, 0],
      [0, r],
    ]

    const x = s.x
    const P = s.P

    const zVec = [zx, zy]
    const y = subVec(zVec, mulMatVec(H, x))

    const S = addMat(mulMat(mulMat(H, P), transpose(H)), R)
    if (!isFinite2(S)) {
      return {
        state: s,
        innovationMm: null,
        sigmaMm: sigma,
        updateApplied: false,
        skipReason: 'invalid_innovation_covariance',
      }
    }

    const SInv = inv2(S)
    if (!SInv) {
      return {
        state: s,
        innovationMm: null,
        sigmaMm: sigma,
        updateApplied: false,
        skipReason: 'invalid_innovation_covariance',
      }
    }

    const K = mulMat(mulMat(P, transpose(H)), SInv)

    const xNew = addVec(x, mulMatVec(K, y))
    const I = ident4()
    const KH = mulMat(K, H)
    const IMinusKH = subMat(I, KH)
    const PNew = symmetrize4(addMat(
      mulMat(mulMat(IMinusKH, P), transpose(IMinusKH)),
      mulMat(mulMat(K, R), transpose(K)),
    ))
    if (!isFiniteMat4(PNew)) {
      return {
        state: s,
        innovationMm: null,
        sigmaMm: sigma,
        updateApplied: false,
        skipReason: 'invalid_posterior_covariance',
      }
    }

    return {
      state: { x: xNew, P: PNew },
      innovationMm: { dx: y[0], dy: y[1] },
      sigmaMm: sigma,
      updateApplied: true,
      skipReason: null,
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

const sanitizeFinite = function sanitizeFinite(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const cloneState = function cloneState(state) {
  const x = isFiniteVec4(state?.x) ? [...state.x] : [0, 0, 0, 0]
  const P = isFiniteMat4(state?.P)
    ? state.P.map((row) => [...row])
    : [
      [1e6, 0,   0,   0],
      [0,   1e6, 0,   0],
      [0,   0,   1e6, 0],
      [0,   0,   0,   1e6],
    ]
  return { x, P }
}

const isFiniteVec4 = function isFiniteVec4(v) {
  return Array.isArray(v)
    && v.length === 4
    && v.every(Number.isFinite)
}

const isFiniteMat4 = function isFiniteMat4(M) {
  return Array.isArray(M)
    && M.length === 4
    && M.every((row) => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite))
}

const isFinite2 = function isFinite2(M) {
  return Number.isFinite(M?.[0]?.[0])
    && Number.isFinite(M?.[0]?.[1])
    && Number.isFinite(M?.[1]?.[0])
    && Number.isFinite(M?.[1]?.[1])
}

const symmetrize4 = function symmetrize4(M) {
  const out = M.map((row) => [...row])
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const m = 0.5 * (out[i][j] + out[j][i])
      out[i][j] = m
      out[j][i] = m
    }
  }
  return out
}

const inv2 = function inv2(M) {
  const a = M[0][0]
  const b = M[0][1]
  const c = M[1][0]
  const d = M[1][1]

  if (![a, b, c, d].every(Number.isFinite)) {
    return null
  }

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
