// test/unit/presenceTrackingPipeline.snapshot.spec.js
import { expect } from 'chai'
import EventBus, { makeStreamKey } from '../../src/core/eventBus.js'
import domainEventTypes from '../../src/domains/domainEventTypes.js'
import { TrackingPipeline } from '../../src/domains/presence/tracking/trackingPipeline.js'
import { busIds } from '../../src/app/buses.js'

const withManualIntervals = async function withManualIntervals(run) {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval

  const timers = []
  globalThis.setInterval = (fn, ms) => {
    const handle = { fn, ms, active: true }
    timers.push(handle)
    return handle
  }
  globalThis.clearInterval = (handle) => {
    if (handle) handle.active = false
  }

  const tick = () => {
    for (const t of timers) {
      if (t.active && typeof t.fn === 'function') t.fn()
    }
  }

  try {
    await run({ tick })
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
}

const makeClock = function makeClock(startMs = 0) {
  let now = startMs
  return {
    nowMs: () => now,
    advance: (ms) => { now += Number(ms) || 0 },
  }
}

const makeConfig = function makeConfig({
  radarCount = 1,
  radarAzimuthDegOverride = null,
  confirmEnabled = true,
  confirmCount = 2,
  confirmWindowMs = 1000,
  updateIntervalMs = 50,
  dropTimeoutMs = 1500,
  staleMeasMaxMs = 500,
  radarMissingTimeoutMs = 1500,
  waitForAllEnabled = false,
  waitForAllTimeoutMs = 0,
  jitterDelayMs = 0,
  fusionEnabled = false,
  fusionFovMarginDeg = 6,
} = {}) {
  const ld2450 = Array.from({ length: radarCount }, (_, radarId) => ({
    publishAs: `LD2450${String.fromCharCode(65 + radarId)}`,
    enabled: true,
  }))

  const radarAzimuthDeg = Array.isArray(radarAzimuthDegOverride) && radarAzimuthDegOverride.length === radarCount
    ? radarAzimuthDegOverride.map((x) => Number(x) || 0)
    : Array.from({ length: radarCount }, (_, idx) => Math.floor((360 * idx) / Math.max(1, radarCount)))

  return {
    enabled: true,
    debug: { enabled: false },
    layout: {
      radarAzimuthDeg,
      radarFovDeg: 120,
      tubeDiameterMm: 100,
      ld2450,
    },
    tracking: {
      mode: 'kf',
      updateIntervalMs,
      maxDtMs: 400,
      dropTimeoutMs,
      snapshot: {
        jitterDelayMs,
        radarBufferMaxFrames: 5,
        radarBufferWindowMs: 4000,
        staleMeasMaxMs,
        radarMissingTimeoutMs,
        waitForAll: { enabled: waitForAllEnabled, timeoutMs: waitForAllTimeoutMs },
      },
      kf: {
        procNoiseAccelMmS2: 1200,
        measNoiseBaseMm: 140,
        initialPosVarMm2: 250000,
        initialVelVarMm2S2: 1440000,
      },
      association: {
        gateD2Max: 1000,
        newTrackConfirmEnabled: confirmEnabled,
        newTrackConfirmCount: confirmCount,
        newTrackConfirmWindowMs: confirmWindowMs,
        newTrackSpawnGateMm: 0,
      },
      fusion: {
        enabled: fusionEnabled,
        clusterGateMm: 360,
        maxClusterSize: 6,
        fovMarginDeg: fusionFovMarginDeg,
        rangeMarginMm: 150,
      },
      health: {
        intervalMs: 50,
      },
    },
  }
}

const publishLd2450Track = function publishLd2450Track({
  bus,
  recvTs,
  measTs = recvTs,
  radarId = 0,
  xMm,
  yMm,
  slotId = 1,
}) {
  const publishAs = `LD2450${String.fromCharCode(65 + radarId)}`

  bus.publish({
    type: domainEventTypes.presence.ld2450Tracks,
    ts: recvTs,
    source: 'test',
    streamKey: makeStreamKey({
      who: 'test',
      what: domainEventTypes.presence.ld2450Tracks,
      where: busIds.presenceInternal,
    }),
    payload: {
      measTs,
      publishAs,
      radarId,
      zoneId: `zone${radarId}`,
      tracks: [{
        world: { xMm, yMm },
        provenance: {
          publishAs,
          radarId,
          slotId,
          measTs,
          localMm: { xMm, yMm },
        },
      }],
      meta: {
        slotCount: 1,
        detectionCount: 1,
      },
    },
  })
}

const globalEventAtTs = function globalEventAtTs(globalEvents, ts) {
  for (let i = globalEvents.length - 1; i >= 0; i -= 1) {
    if (Number(globalEvents[i]?.ts) === Number(ts)) return globalEvents[i]
  }

  return null
}

const confirmedCount = function confirmedCount(globalEvent) {
  const tracks = Array.isArray(globalEvent?.payload?.tracks) ? globalEvent.payload.tracks : []
  return tracks.filter((t) => t?.state === 'confirmed').length
}

const allLastSeenMsEqual = function allLastSeenMsEqual(globalEvent, expectedMs) {
  const tracks = Array.isArray(globalEvent?.payload?.tracks) ? globalEvent.payload.tracks : []
  if (tracks.length === 0) return false
  return tracks.every((t) => Number(t?.lastSeenMs) === Number(expectedMs))
}

describe('TrackingPipeline snapshot integration', function () {
  it('with waitForAll enabled, snapshots still advance on timeout with missing expected radars', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({
          radarCount: 3,
          confirmEnabled: false,
          waitForAllEnabled: true,
          waitForAllTimeoutMs: 110,
        }),
      })

      pipeline.start()

      for (let i = 0; i < 6; i += 1) {
        clock.advance(50)
        const now = clock.nowMs()

        if (now >= 1100 && now % 100 === 0) {
          for (const radarId of [0, 1]) {
            publishLd2450Track({
              bus: presenceInternalBus,
              recvTs: now,
              measTs: now,
              radarId,
              xMm: 1200 + radarId,
              yMm: 1400 + radarId,
            })
          }
        }

        tick()
      }

      const e1100 = globalEventAtTs(globalEvents, 1100)
      const e1150 = globalEventAtTs(globalEvents, 1150)
      const e1200 = globalEventAtTs(globalEvents, 1200)

      expect(e1100?.payload?.meta?.snapshotChangedThisTick).to.equal(true)
      expect(e1150?.payload?.meta?.snapshotChangedThisTick).to.equal(false)
      expect(e1200?.payload?.meta?.snapshotChangedThisTick).to.equal(true)

      expect(e1100?.payload?.meta?.snapshotKey).to.equal('0:1100|1:1100|2:na')
      expect(e1200?.payload?.meta?.snapshotKey).to.equal('0:1200|1:1200|2:na')

      expect(e1100?.payload?.meta?.radarsMissing).to.equal(1)
      expect(e1150?.payload?.meta?.radarsMissing).to.equal(1)
      expect(e1200?.payload?.meta?.radarsMissing).to.equal(1)

      pipeline.dispose()
      unsub()
    })
  })

  it('clamps out-of-order measTs and only consumes when snapshotKey changes', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({ radarCount: 1, confirmEnabled: true, confirmCount: 2 }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: 1000,
        radarId: 0,
        xMm: 1000,
        yMm: 1500,
      })

      clock.advance(50)
      tick()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: 900, // out-of-order; should clamp to prev+1
        radarId: 0,
        xMm: 1010,
        yMm: 1510,
      })

      clock.advance(50)
      tick()

      clock.advance(50)
      tick()

      const changed = globalEvents
        .map((e) => e?.payload?.meta || null)
        .filter((m) => m?.snapshotChangedThisTick === true)

      expect(changed).to.have.length(2)
      expect(changed[0].snapshotKey).to.equal('0:1000')
      expect(changed[1].snapshotKey).to.equal('0:1001')

      const lastMeta = globalEvents[globalEvents.length - 1]?.payload?.meta || {}
      expect(lastMeta.snapshotChangedThisTick).to.equal(false)
      expect(lastMeta.snapshotKey).to.equal('0:1001')

      pipeline.dispose()
      unsub()
    })
  })

  it('clamps out-of-order measTs per radar independently in snapshotKey', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({ radarCount: 2, confirmEnabled: false }),
      })

      pipeline.start()

      for (const radarId of [0, 1]) {
        publishLd2450Track({
          bus: presenceInternalBus,
          recvTs: clock.nowMs(),
          measTs: 1000,
          radarId,
          xMm: 1000 + radarId,
          yMm: 1400 + radarId,
        })
      }

      clock.advance(50)
      tick()

      clock.advance(50)
      for (const item of [
        { radarId: 0, measTs: 900, xMm: 1010, yMm: 1410 }, // backward on radar0 -> clamp to 1001
        { radarId: 1, measTs: 1100, xMm: 1020, yMm: 1420 }, // forward on radar1
      ]) {
        publishLd2450Track({
          bus: presenceInternalBus,
          recvTs: clock.nowMs(),
          measTs: item.measTs,
          radarId: item.radarId,
          xMm: item.xMm,
          yMm: item.yMm,
        })
      }
      tick()

      const e1050 = globalEventAtTs(globalEvents, 1050)
      const e1100 = globalEventAtTs(globalEvents, 1100)

      expect(e1050?.payload?.meta?.snapshotKey).to.equal('0:1000|1:1000')
      expect(e1050?.payload?.meta?.snapshotChangedThisTick).to.equal(true)

      expect(e1100?.payload?.meta?.snapshotKey).to.equal('0:1001|1:1100')
      expect(e1100?.payload?.meta?.snapshotChangedThisTick).to.equal(true)

      pipeline.dispose()
      unsub()
    })
  })

  it('at 50ms tick with 3 radars @100ms, snapshotKey changes about every 100ms and association updates only on changed snapshots', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({
          radarCount: 3,
          confirmEnabled: true,
          confirmCount: 3,
          confirmWindowMs: 5000,
          waitForAllEnabled: true,
          waitForAllTimeoutMs: 110,
          jitterDelayMs: 0,
          fusionEnabled: false,
        }),
      })

      pipeline.start()

      for (let i = 0; i < 10; i += 1) {
        clock.advance(50)
        const now = clock.nowMs()

        if (now >= 1100 && now % 100 === 0) {
          for (let radarId = 0; radarId < 3; radarId += 1) {
            publishLd2450Track({
              bus: presenceInternalBus,
              recvTs: now,
              measTs: now,
              radarId,
              xMm: 1200 + radarId,
              yMm: 1400 + radarId,
            })
          }
        }

        tick()
      }

      const e1100 = globalEventAtTs(globalEvents, 1100)
      const e1150 = globalEventAtTs(globalEvents, 1150)
      const e1200 = globalEventAtTs(globalEvents, 1200)
      const e1250 = globalEventAtTs(globalEvents, 1250)
      const e1300 = globalEventAtTs(globalEvents, 1300)

      expect(e1100?.payload?.meta?.snapshotChangedThisTick).to.equal(true)
      expect(e1150?.payload?.meta?.snapshotChangedThisTick).to.equal(false)
      expect(e1200?.payload?.meta?.snapshotChangedThisTick).to.equal(true)
      expect(e1250?.payload?.meta?.snapshotChangedThisTick).to.equal(false)
      expect(e1300?.payload?.meta?.snapshotChangedThisTick).to.equal(true)

      expect(e1100?.payload?.meta?.snapshotKey).to.equal(e1150?.payload?.meta?.snapshotKey)
      expect(e1200?.payload?.meta?.snapshotKey).to.equal(e1250?.payload?.meta?.snapshotKey)
      expect(e1100?.payload?.meta?.snapshotKey).to.not.equal(e1200?.payload?.meta?.snapshotKey)
      expect(e1200?.payload?.meta?.snapshotKey).to.not.equal(e1300?.payload?.meta?.snapshotKey)

      const changedTs = globalEvents
        .filter((e) => Number(e?.ts) >= 1100 && e?.payload?.meta?.snapshotChangedThisTick === true)
        .map((e) => Number(e.ts))

      expect(changedTs).to.include.members([1100, 1200, 1300])
      for (let i = 1; i < changedTs.length; i += 1) {
        expect(changedTs[i] - changedTs[i - 1]).to.equal(100)
      }

      expect((e1100?.payload?.tracks || []).length).to.equal(3)
      expect((e1150?.payload?.tracks || []).length).to.equal(3)
      expect((e1200?.payload?.tracks || []).length).to.equal(3)
      expect((e1250?.payload?.tracks || []).length).to.equal(3)
      expect((e1300?.payload?.tracks || []).length).to.equal(3)

      expect(confirmedCount(e1100)).to.equal(0)
      expect(confirmedCount(e1150)).to.equal(0)
      expect(confirmedCount(e1200)).to.equal(0)
      expect(confirmedCount(e1250)).to.equal(0)
      expect(confirmedCount(e1300)).to.equal(3)

      expect(allLastSeenMsEqual(e1100, 0)).to.equal(true)
      expect(allLastSeenMsEqual(e1150, 50)).to.equal(true)
      expect(allLastSeenMsEqual(e1200, 0)).to.equal(true)
      expect(allLastSeenMsEqual(e1250, 50)).to.equal(true)
      expect(allLastSeenMsEqual(e1300, 0)).to.equal(true)

      pipeline.dispose()
      unsub()
    })
  })

  it('excludes missing radar measurements after radarMissingTimeoutMs in pipeline output meta', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({
          radarCount: 2,
          confirmEnabled: false,
          staleMeasMaxMs: 100,
          radarMissingTimeoutMs: 200,
          waitForAllEnabled: false,
        }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: clock.nowMs(),
        radarId: 0,
        xMm: 1000,
        yMm: 1400,
      })
      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: clock.nowMs(),
        radarId: 1,
        xMm: 1010,
        yMm: 1400,
      })

      for (let i = 0; i < 6; i += 1) {
        clock.advance(50)
        const now = clock.nowMs()

        publishLd2450Track({
          bus: presenceInternalBus,
          recvTs: now,
          measTs: now,
          radarId: 0,
          xMm: 1000 + i,
          yMm: 1400,
        })

        tick()
      }

      const e1300 = globalEventAtTs(globalEvents, 1300)
      const meta = e1300?.payload?.meta || {}

      expect(meta.radarsFresh).to.equal(1)
      expect(meta.radarsMissing).to.equal(1)
      expect(meta.measIn).to.equal(1)

      pipeline.dispose()
      unsub()
    })
  })

  it('does not overwrite lastRadarId from representative radar on multi-radar fused updates', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: makeConfig({
          radarCount: 2,
          radarAzimuthDegOverride: [0, 0],
          confirmEnabled: false,
          waitForAllEnabled: false,
          fusionEnabled: true,
          fusionFovMarginDeg: 200,
        }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: clock.nowMs(),
        radarId: 0,
        xMm: 1000,
        yMm: 1400,
      })

      clock.advance(50)
      tick()

      const e1050 = globalEventAtTs(globalEvents, 1050)
      const t1050 = Array.isArray(e1050?.payload?.tracks) ? e1050.payload.tracks[0] : null
      expect(t1050).to.not.equal(null)
      expect(Number(t1050.lastRadarId)).to.equal(0)

      clock.advance(50)
      const now = clock.nowMs()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: now,
        measTs: now,
        radarId: 0,
        xMm: 1010,
        yMm: 1410,
      })
      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: now,
        measTs: now,
        radarId: 1,
        xMm: 1015,
        yMm: 1415,
      })

      tick()

      const e1100 = globalEventAtTs(globalEvents, 1100)
      const t1100 = Array.isArray(e1100?.payload?.tracks) ? e1100.payload.tracks[0] : null
      expect(t1100).to.not.equal(null)
      expect(Number(t1100.lastRadarId)).to.equal(0)
      expect((t1100.sourceRadars || []).sort((a, b) => a - b)).to.deep.equal([0, 1])

      pipeline.dispose()
      unsub()
    })
  })

  it('treats multi-radar fused measurements as radar-neutral in switch-penalty association', async function () {
    await withManualIntervals(async ({ tick }) => {
      const clock = makeClock(1000)
      const presenceInternalBus = new EventBus({ busId: 'presenceInternal', strict: true })
      const globalEvents = []

      const unsub = presenceInternalBus.subscribe((event) => {
        if (event?.type !== domainEventTypes.presence.globalTracks) return
        globalEvents.push(event)
      })

      const cfg = makeConfig({
        radarCount: 2,
        radarAzimuthDegOverride: [0, 0],
        confirmEnabled: false,
        waitForAllEnabled: false,
        fusionEnabled: true,
        fusionFovMarginDeg: 200,
      })
      cfg.tracking.mode = 'assocOnly'

      const pipeline = new TrackingPipeline({
        logger: { notice: () => {}, error: () => {} },
        clock,
        controllerId: 'presenceController',
        presenceInternalBus,
        controllerConfig: cfg,
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: clock.nowMs(),
        measTs: clock.nowMs(),
        radarId: 1,
        xMm: 1000,
        yMm: 1400,
        slotId: 1,
      })

      clock.advance(50)
      tick()

      const e1050 = globalEventAtTs(globalEvents, 1050)
      const t1050 = Array.isArray(e1050?.payload?.tracks) ? e1050.payload.tracks[0] : null
      expect(t1050).to.not.equal(null)
      const originalId = String(t1050.id)
      expect(Number(t1050.lastRadarId)).to.equal(1)

      clock.advance(50)
      const now = clock.nowMs()

      publishLd2450Track({
        bus: presenceInternalBus,
        recvTs: now,
        measTs: now,
        radarId: 0,
        xMm: 1000,
        yMm: 1400,
        slotId: 1,
      })

      presenceInternalBus.publish({
        type: domainEventTypes.presence.ld2450Tracks,
        ts: now,
        source: 'test',
        streamKey: makeStreamKey({
          who: 'test',
          what: domainEventTypes.presence.ld2450Tracks,
          where: busIds.presenceInternal,
        }),
        payload: {
          measTs: now,
          publishAs: 'LD2450B',
          radarId: 1,
          zoneId: 'zone1',
          tracks: [
            {
              world: { xMm: 1050, yMm: 1400 },
              provenance: {
                publishAs: 'LD2450B',
                radarId: 1,
                slotId: 1,
                measTs: now,
                localMm: { xMm: 1050, yMm: 1400 },
              },
            },
            {
              world: { xMm: 1000, yMm: 1850 },
              provenance: {
                publishAs: 'LD2450B',
                radarId: 1,
                slotId: 2,
                measTs: now,
                localMm: { xMm: 1000, yMm: 1850 },
              },
            },
          ],
          meta: {
            slotCount: 2,
            detectionCount: 2,
          },
        },
      })

      tick()

      const e1100 = globalEventAtTs(globalEvents, 1100)
      const tracks1100 = Array.isArray(e1100?.payload?.tracks) ? e1100.payload.tracks : []
      const updatedOriginal = tracks1100.find((t) => String(t?.id) === originalId) || null
      expect(updatedOriginal).to.not.equal(null)
      expect((updatedOriginal.sourceRadars || []).sort((a, b) => a - b)).to.deep.equal([0, 1])

      pipeline.dispose()
      unsub()
    })
  })
})
