// test/unit/kalmanFilterCv2d.spec.js
import { expect } from 'chai'
import { KalmanFilterCv2d } from '../../src/domains/presence/tracking/kalmanFilterCv2d.js'

const makeState = function makeState() {
  return {
    x: [100, 200, 5, -3],
    P: [
      [10, 2,  1, 0],
      [2,  12, 0, 1],
      [1,  0,  7, 2],
      [0,  1,  2, 9],
    ],
  }
}

describe('KalmanFilterCv2d', function () {
  it('createInitial sanitizes non-finite x/y to 0', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const init = kf.createInitial({ xMm: Number.NaN, yMm: Number.POSITIVE_INFINITY })

    expect(init.x).to.deep.equal([0, 0, 0, 0])
  })

  it('predict(dt<=0) returns a deep-cloned state (no aliasing)', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = makeState()

    const pred = kf.predict(state, 0)

    expect(pred).to.deep.equal(state)
    expect(pred).to.not.equal(state)
    expect(pred.x).to.not.equal(state.x)
    expect(pred.P).to.not.equal(state.P)
    expect(pred.P[0]).to.not.equal(state.P[0])

    pred.x[0] = 999
    pred.P[0][0] = 999

    expect(state.x[0]).to.equal(100)
    expect(state.P[0][0]).to.equal(10)
  })

  it('predict(dt<=0) uses large covariance fallback when state.P is missing', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const pred = kf.predict({ x: [1, 2, 3, 4] }, 0)

    expect(pred.P).to.deep.equal([
      [1e6, 0,   0,   0],
      [0,   1e6, 0,   0],
      [0,   0,   1e6, 0],
      [0,   0,   0,   1e6],
    ])
  })

  it('uses acceleration sigma squared exactly once for process noise Q', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 1, 0],
      P: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    }

    const pred = kf.predict(state, 0.5)
    const P = pred.P

    expect(pred.x[0]).to.equal(0.5)
    expect(P[0][0]).to.equal(0.0625)
    expect(P[0][2]).to.equal(0.25)
    expect(P[2][0]).to.equal(0.25)
    expect(P[2][2]).to.equal(1)
    expect(P[1][1]).to.equal(0.0625)
    expect(P[1][3]).to.equal(0.25)
    expect(P[3][1]).to.equal(0.25)
    expect(P[3][3]).to.equal(1)
  })

  it('clamps negative process-accel sigma to 0 (zero process noise)', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: -2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 2, -1],
      P: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    }

    const pred = kf.predict(state, 0.5)
    expect(pred.x).to.deep.equal([1, -0.5, 2, -1])
    expect(pred.P).to.deep.equal(state.P)
  })

  it('predict follows constant-velocity state transition with zero process noise', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: -1, measNoiseBaseMm: 10 })
    const state = {
      x: [10, 20, 3, -4],
      P: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    }

    const pred = kf.predict(state, 0.5)
    expect(pred.x).to.deep.equal([11.5, 18, 3, -4])
    expect(pred.x[2]).to.equal(3)
    expect(pred.x[3]).to.equal(-4)
  })

  it('predict output covariance is symmetrized', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 0, 0],
      P: [
        [10, 5, 0, 0],
        [1, 12, 0, 0],
        [0, 0, 7, 3],
        [0, 0, 2, 9],
      ],
    }

    const pred = kf.predict(state, 0.1)
    for (let i = 0; i < pred.P.length; i += 1) {
      for (let j = i + 1; j < pred.P.length; j += 1) {
        expect(Math.abs(pred.P[i][j] - pred.P[j][i])).to.be.lessThan(1e-9)
      }
    }
  })

  it('predict(dt>0) sanitizes malformed state before matrix math', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const pred = kf.predict({ x: null, P: null }, 0.1)

    expect(pred.x).to.have.length(4)
    expect(pred.P).to.have.length(4)
    expect(pred.x.every(Number.isFinite)).to.equal(true)
    expect(pred.P.every((row) => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite))).to.equal(true)
  })

  it('rejects invalid measurements and returns unchanged state with debug reason', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = makeState()

    const upd = kf.updateWithDebug(state, { xMm: Number.NaN, yMm: 30 }, 5)

    expect(upd.updateApplied).to.equal(false)
    expect(upd.skipReason).to.equal('invalid_measurement')
    expect(upd.innovationMm).to.equal(null)
    expect(upd.state).to.deep.equal(state)
    expect(upd.state).to.not.equal(state)
    expect(upd.state.x).to.not.equal(state.x)
    expect(upd.state.P).to.not.equal(state.P)
  })

  it('clamps measurement sigma to minimum 1mm', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = makeState()

    const upd = kf.updateWithDebug(state, { xMm: 100, yMm: 200 }, -5)

    expect(upd.sigmaMm).to.equal(1)
  })

  it('uses passed measurement sigma directly (after min clamp), not measNoiseBaseMm', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 9999 })
    const state = makeState()

    const upd = kf.updateWithDebug(state, { xMm: 101, yMm: 199 }, 3)

    expect(upd.sigmaMm).to.equal(3)
  })

  it('skips update when innovation covariance is non-finite/singular', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = makeState()
    state.P = [
      [1e308, 1e308, 0, 0],
      [1e308, 1e308, 0, 0],
      [0,     0,     1, 0],
      [0,     0,     0, 1],
    ]

    const upd = kf.updateWithDebug(state, { xMm: 105, yMm: 198 }, 5)

    expect(upd.updateApplied).to.equal(false)
    expect(upd.skipReason).to.equal('invalid_innovation_covariance')
    expect(upd.innovationMm).to.equal(null)
    expect(upd.state).to.deep.equal(state)
    expect(upd.state).to.not.equal(state)
    expect(upd.state.x).to.not.equal(state.x)
    expect(upd.state.P).to.not.equal(state.P)
  })

  it('moves state toward measurement when position covariance is high and noise is small', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 0, 0],
      P: [
        [1e6, 0,    0, 0],
        [0,   1e6,  0, 0],
        [0,   0,  100, 0],
        [0,   0,    0, 100],
      ],
    }

    const upd = kf.updateWithDebug(state, { xMm: 100, yMm: 0 }, 1)

    expect(upd.updateApplied).to.equal(true)
    expect(upd.innovationMm.dx).to.equal(100)
    expect(upd.state.x[0]).to.be.greaterThan(50)
    expect(upd.state.x[0]).to.be.lessThan(100)
  })

  it('measurement noise controls update strength and covariance reduction', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 0, 0],
      P: [
        [1e6, 0,    0, 0],
        [0,   1e6,  0, 0],
        [0,   0,  100, 0],
        [0,   0,    0, 100],
      ],
    }

    const updSmall = kf.updateWithDebug(state, { xMm: 100, yMm: 0 }, 1)
    const updHuge = kf.updateWithDebug(state, { xMm: 100, yMm: 0 }, 1e6)

    const dxSmall = Math.abs(updSmall.state.x[0] - state.x[0])
    const dxHuge = Math.abs(updHuge.state.x[0] - state.x[0])

    expect(dxSmall).to.be.greaterThan(dxHuge)
    expect(updSmall.state.P[0][0]).to.be.lessThan(updHuge.state.P[0][0])
  })

  it('skips update when posterior covariance becomes non-finite', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 0, 0],
      P: [
        [1,     0,     1e308, 0],
        [0,     1,     0,     1e308],
        [1e308, 0,     1e6,   0],
        [0,     1e308, 0,     1e6],
      ],
    }

    const upd = kf.updateWithDebug(state, { xMm: 10, yMm: 10 }, 1)

    expect(upd.updateApplied).to.equal(false)
    expect([
      'invalid_innovation_covariance',
      'invalid_posterior_covariance',
    ]).to.include(upd.skipReason)
    expect(upd.innovationMm).to.equal(null)
    expect(upd.state).to.deep.equal(state)
    expect(upd.state).to.not.equal(state)
    expect(upd.state.x).to.not.equal(state.x)
    expect(upd.state.P).to.not.equal(state.P)
  })

  it('successful update returns non-aliased state', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = {
      x: [0, 0, 0, 0],
      P: [
        [1e4, 0,   0, 0],
        [0,   1e4, 0, 0],
        [0,   0, 100, 0],
        [0,   0,   0, 100],
      ],
    }

    const upd = kf.updateWithDebug(state, { xMm: 20, yMm: -10 }, 2)
    expect(upd.updateApplied).to.equal(true)

    upd.state.x[0] = 999
    upd.state.P[0][0] = 999

    expect(state.x[0]).to.equal(0)
    expect(state.P[0][0]).to.equal(1e4)
  })

  it('uses Joseph covariance update and preserves symmetry', function () {
    const kf = new KalmanFilterCv2d({ procNoiseAccelMmS2: 2, measNoiseBaseMm: 10 })
    const state = makeState()

    const upd = kf.updateWithDebug(state, { xMm: 110, yMm: 205 }, 5)
    const P = upd.state.P

    expect(upd.updateApplied).to.equal(true)
    for (let i = 0; i < P.length; i += 1) {
      for (let j = i + 1; j < P.length; j += 1) {
        expect(Math.abs(P[i][j] - P[j][i])).to.be.lessThan(1e-9)
      }
    }
  })
})
