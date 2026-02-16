// test/unit/fusionClusterer.spec.js
import { expect } from 'chai'
import { FusionClusterer } from '../../src/domains/presence/tracking/fusion/fusionClusterer.js'

const makeCfg = function makeCfg() {
  return {
    tracking: {
      fusion: {
        enabled: true,
        clusterGateMm: 200,
        maxClusterSize: 10,
        fovMarginDeg: 6,
        rangeMarginMm: 150,
      },
    },
    layout: {
      radarFovDeg: 120,
    },
    quality: {
      edgeBearingCutoffDeg: 45,
      rangeCutoffMm: 3000,
    },
  }
}

const transform = {
  toLocalMm: ({ xMm, yMm }) => ({ xMm, yMm }),
}

describe('FusionClusterer', function () {
  it('sets prov=null for fused multi-radar observations', function () {
    const clusterer = new FusionClusterer({ cfg: makeCfg(), transform })

    const aProv = { publishAs: 'LD2450A', radarId: 0, slotId: 1, localMm: { xMm: 100, yMm: 1000 } }
    const bProv = { publishAs: 'LD2450B', radarId: 1, slotId: 1, localMm: { xMm: 110, yMm: 1010 } }

    const res = clusterer.cluster({
      observations: [
        { measTs: 1000, radarId: 0, zoneId: 'z0', xMm: 100, yMm: 1000, sourceRadars: [0], prov: aProv },
        { measTs: 1001, radarId: 1, zoneId: 'z1', xMm: 110, yMm: 1010, sourceRadars: [1], prov: bProv },
      ],
      measVarMm2ByIdx: [25, 25],
      now: 1100,
      debugEnabled: false,
    })

    expect(res.observations).to.have.length(1)
    const fused = res.observations[0]
    expect([...fused.sourceRadars].sort((x, y) => x - y)).to.deep.equal([0, 1])
    expect(fused.prov).to.equal(null)
  })

  it('keeps representative prov for fused single-radar observations', function () {
    const clusterer = new FusionClusterer({ cfg: makeCfg(), transform })

    const bestProv = { publishAs: 'LD2450A', radarId: 0, slotId: 1, localMm: { xMm: 100, yMm: 1000 } }
    const res = clusterer.cluster({
      observations: [
        { measTs: 1000, radarId: 0, zoneId: 'z0', xMm: 100, yMm: 1000, sourceRadars: [0], prov: bestProv },
        { measTs: 1001, radarId: 0, zoneId: 'z0', xMm: 102, yMm: 1002, sourceRadars: [0], prov: { publishAs: 'LD2450A', radarId: 0, slotId: 2 } },
      ],
      measVarMm2ByIdx: [9, 100],
      now: 1100,
      debugEnabled: false,
    })

    expect(res.observations).to.have.length(1)
    const fused = res.observations[0]
    expect(fused.sourceRadars).to.deep.equal([0])
    expect(fused.prov).to.deep.equal(bestProv)
  })
})
