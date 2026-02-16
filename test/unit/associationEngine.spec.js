  import { expect } from 'chai'
  import { AssociationEngine } from '../../src/domains/presence/tracking/associationEngine.js'

  const normalizedD2 = function normalizedD2(track, meas, varMm2) {
    const dx = Number(meas.xMm) - Number(track.xMm)
    const dy = Number(meas.yMm) - Number(track.yMm)
    return ((dx * dx) + (dy * dy)) / Math.max(1, Number(varMm2) || 1)
  }

  const trackOrderGreedy = function trackOrderGreedy({ tracks, measurements, measVarMm2ByIdx, gateD2Max }) {
    const assignments = new Map()
    const usedMeas = new Set()
    const vars = Array.isArray(measVarMm2ByIdx) ? measVarMm2ByIdx : []
    const gate = Number(gateD2Max) || 0

    for (const track of tracks) {
      let bestIdx = -1
      let bestD2 = Infinity

      for (let i = 0; i < measurements.length; i += 1) {
        if (usedMeas.has(i)) continue

        const varMm2 = Math.max(1, Number(vars[i]) || 1)
        const dx = Number(measurements[i].xMm) - Number(track.xMm)
        const dy = Number(measurements[i].yMm) - Number(track.yMm)
        const dist2 = (dx * dx) + (dy * dy)
        if (dist2 > (gate * varMm2)) continue

        const d2 = dist2 / varMm2
        if (d2 < bestD2) {
          bestD2 = d2
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        usedMeas.add(bestIdx)
        assignments.set(track.id, bestIdx)
      }
    }

    return assignments
  }

  describe('AssociationEngine', function () {
    it('differs from track-order greedy by selecting the globally cheapest edge first', function () {
      const engine = new AssociationEngine({ gateD2Max: 200 })

      const tracks = [
        { id: 'tA', xMm: 0, yMm: 0, state: 'confirmed' },
        { id: 'tB', xMm: 10, yMm: 0, state: 'confirmed' },
      ]

      const measurements = [
        { xMm: 9, yMm: 0, radarId: 0 }, // tB->m0 is globally smallest d2 (0.01 with var=100)
        { xMm: 1, yMm: 0, radarId: 0 }, // tA slightly prefers m0 over m1 (0.81 vs 1.0)
      ]
      const measVarMm2ByIdx = [100, 1]

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx,
      })

      const trackOrder = trackOrderGreedy({
        tracks,
        measurements,
        measVarMm2ByIdx,
        gateD2Max: 200,
      })

      expect(assignments.size).to.equal(2)
      expect(assignments.get('tA')).to.equal(1)
      expect(assignments.get('tB')).to.equal(0)
      expect(trackOrder.get('tA')).to.equal(0)
      expect(trackOrder.get('tB')).to.equal(1)
      expect(unassignedMeas).to.deep.equal([])
      expect(unassignedTracks).to.deep.equal([])
    })

    it('biases confirmed tracks in conflicts via tentative penalty', function () {
      const engine = new AssociationEngine({
        gateD2Max: 100,
        tentativePenalty: 5,
      })

      const tracks = [
        { id: 'tTent', xMm: 0, yMm: 0, state: 'tentative' },
        { id: 'tConf', xMm: 0, yMm: 0, state: 'confirmed' },
      ]

      const measurements = [{ xMm: 1, yMm: 0, radarId: 0 }]

      const { assignments, unassignedTracks, unassignedMeas } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('tConf')).to.equal(0)
      expect(unassignedTracks).to.deep.equal(['tTent'])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('breaks equal-cost conflicts by older track age, then track id', function () {
      const engine = new AssociationEngine({ gateD2Max: 100 })

      const tracks = [
        { id: 'newer', xMm: 0, yMm: 0, ageMs: 50, state: 'confirmed' },
        { id: 'older', xMm: 0, yMm: 0, ageMs: 500, state: 'confirmed' },
      ]

      const measurements = [
        { xMm: 1, yMm: 0, radarId: 0 },
      ]

      const { assignments, unassignedTracks, unassignedMeas } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('older')).to.equal(0)
      expect(unassignedTracks).to.deep.equal(['newer'])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('breaks equal-cost conflicts by confirmed state before age', function () {
      const engine = new AssociationEngine({ gateD2Max: 100, tentativePenalty: 0 })

      const tracks = [
        { id: 'tentativeOld', xMm: 0, yMm: 0, ageMs: 1000, state: 'tentative' },
        { id: 'confirmedNew', xMm: 0, yMm: 0, ageMs: 10, state: 'confirmed' },
      ]

      const measurements = [{ xMm: 1, yMm: 0, radarId: 0 }]

      const { assignments, unassignedTracks, unassignedMeas } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('confirmedNew')).to.equal(0)
      expect(unassignedTracks).to.deep.equal(['tentativeOld'])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('uses trackId as final tie-break for single-measurement equal-cost conflicts', function () {
      const engine = new AssociationEngine({ gateD2Max: 100 })

      const tracks = [
        { id: 'bTrack', xMm: 0, yMm: 0, ageMs: 100, state: 'confirmed' },
        { id: 'aTrack', xMm: 0, yMm: 0, ageMs: 100, state: 'confirmed' },
      ]
      const measurements = [{ xMm: 1, yMm: 0, radarId: 0 }]

      const { assignments, unassignedTracks, unassignedMeas } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('aTrack')).to.equal(0)
      expect(unassignedTracks).to.deep.equal(['bTrack'])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('supports radar-switch penalty in cost scoring with small distance deltas', function () {
      const engine = new AssociationEngine({
        gateD2Max: 100,
        radarSwitchPenaltyFn: (track, meas) => (track.lastRadarId === meas.radarId ? 0 : 0.2),
      })

      const tracks = [
        { id: 't1', xMm: 0, yMm: 0, state: 'confirmed', lastRadarId: 0 },
      ]

      const measurements = [
        { xMm: 1, yMm: 0, radarId: 1 },
        { xMm: 1.05, yMm: 0, radarId: 0 },
      ]

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks,
        measurements,
        measVarMm2ByIdx: [1, 1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('t1')).to.equal(1)
      expect(unassignedMeas).to.deep.equal([0])
      expect(unassignedTracks).to.deep.equal([])
    })

    it('ignores invalid ids/non-finite measurements and does not include them in unassigned lists', function () {
      const engine = new AssociationEngine({ gateD2Max: 100 })

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks: [
          { id: '', xMm: 0, yMm: 0, state: 'confirmed' },
          { id: 't1', xMm: 0, yMm: 0, state: 'confirmed' },
        ],
        measurements: [
          { xMm: Number.NaN, yMm: 0, radarId: 0 },
          { xMm: 1, yMm: 0, radarId: 0 },
        ],
        measVarMm2ByIdx: [1, 1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('t1')).to.equal(1)
      expect(unassignedTracks).to.deep.equal([])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('ignores non-finite track coordinates and does not report them as unassigned', function () {
      const engine = new AssociationEngine({ gateD2Max: 100 })

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks: [
          { id: 'bad', xMm: Number.POSITIVE_INFINITY, yMm: 0, state: 'confirmed' },
          { id: 'good', xMm: 0, yMm: 0, state: 'confirmed' },
        ],
        measurements: [{ xMm: 2, yMm: 0, radarId: 0 }],
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('good')).to.equal(0)
      expect(unassignedTracks).to.deep.equal([])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('dedupes duplicate track ids (first track wins identity)', function () {
      const engine = new AssociationEngine({ gateD2Max: 100 })

      const { assignments, unassignedTracks, unassignedMeas } = engine.associate({
        tracks: [
          { id: 'dup', xMm: 0, yMm: 0, state: 'confirmed' },
          { id: 'dup', xMm: 100, yMm: 0, state: 'confirmed' },
        ],
        measurements: [{ xMm: 1, yMm: 0, radarId: 0 }],
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('dup')).to.equal(0)
      expect(unassignedTracks).to.deep.equal([])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('applies variance-scaled gate (high variance can admit far measurements)', function () {
      const engine = new AssociationEngine({ gateD2Max: 9.21 })

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks: [{ id: 't1', xMm: 0, yMm: 0, state: 'confirmed' }],
        measurements: [
          { xMm: 10, yMm: 0, radarId: 0 }, // d2=100 with var=1 -> rejected
          { xMm: 10, yMm: 0, radarId: 0 }, // d2=1 with var=100 -> accepted
        ],
        measVarMm2ByIdx: [1, 100],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('t1')).to.equal(1)
      expect(unassignedTracks).to.deep.equal([])
      expect(unassignedMeas).to.deep.equal([0])
    })

    it('defaults missing meas variance entries to 1', function () {
      const engine = new AssociationEngine({ gateD2Max: 9.21 })

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks: [{ id: 't1', xMm: 0, yMm: 0, state: 'confirmed' }],
        measurements: [
          { xMm: 2, yMm: 0, radarId: 0 }, // d2=4, var missing => uses 1
        ],
        measVarMm2ByIdx: [],
      })

      expect(assignments.size).to.equal(1)
      expect(assignments.get('t1')).to.equal(0)
      expect(unassignedTracks).to.deep.equal([])
      expect(unassignedMeas).to.deep.equal([])
    })

    it('returns unassigned tracks and measurements', function () {
      const engine = new AssociationEngine({ gateD2Max: 1 })

      const { assignments, unassignedMeas, unassignedTracks } = engine.associate({
        tracks: [{ id: 't1', xMm: 0, yMm: 0, state: 'confirmed' }],
        measurements: [{ xMm: 10, yMm: 0, radarId: 0 }],
        measVarMm2ByIdx: [1],
      })

      expect(assignments.size).to.equal(0)
      expect(unassignedTracks).to.deep.equal(['t1'])
      expect(unassignedMeas).to.deep.equal([0])
    })
  })
