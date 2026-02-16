import { expect } from 'chai'
import EventBus, { makeStreamKey } from '../../src/core/eventBus.js'
import domainEventTypes from '../../src/domains/domainEventTypes.js'
import { TrackingPipeline } from '../../src/domains/presence/tracking/trackingPipeline.js'

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
  mode = 'kf',
  confirmEnabled = true,
  confirmCount = 2,
  confirmWindowMs = 1000,
} = {}) {
  return {
    enabled: true,
    debug: { enabled: false },
    layout: {
      ld2450: [{ publishAs: 'LD2450A', enabled: true }],
    },
    tracking: {
      mode,
      updateIntervalMs: 50,
      maxDtMs: 400,
      dropTimeoutMs: 1500,
      snapshot: {
        jitterDelayMs: 0,
        radarBufferMaxFrames: 5,
        radarBufferWindowMs: 4000,
        staleMeasMaxMs: 500,
        radarMissingTimeoutMs: 1500,
        waitForAll: { enabled: false, timeoutMs: 0 },
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
        enabled: false,
      },
    },
  }
}

const publishLd2450Track = function publishLd2450Track({ bus, now, measTs = now, xMm, yMm, slotId = 1 }) {
  bus.publish({
    type: domainEventTypes.presence.ld2450Tracks,
    ts: now,
    source: 'test',
    streamKey: makeStreamKey({
      who: 'test',
      what: domainEventTypes.presence.ld2450Tracks,
      where: 'presenceInternal',
    }),
    payload: {
      measTs,
      publishAs: 'LD2450A',
      radarId: 0,
      zoneId: 'zone0',
      tracks: [{
        world: { xMm, yMm },
        provenance: {
          publishAs: 'LD2450A',
          radarId: 0,
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

const lastGlobalTrack = function lastGlobalTrack(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const tracks = Array.isArray(events[i]?.payload?.tracks) ? events[i].payload.tracks : []
    if (tracks.length > 0) {
      return { track: tracks[0], meta: events[i].payload.meta || {} }
    }
  }

  return { track: null, meta: {} }
}

describe('TrackingPipeline (presence)', function () {
  it('consumes each snapshot once: no repeat-confirm on unchanged snapshot at 50ms', async function () {
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
        controllerConfig: makeConfig({ confirmEnabled: true, confirmCount: 2 }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1200,
        yMm: 1400,
      })

      clock.advance(50)
      tick()

      let latest = lastGlobalTrack(globalEvents)
      expect(latest.track).to.not.equal(null)
      expect(latest.track.state).to.equal('tentative')
      expect(latest.meta.snapshotChangedThisTick).to.equal(true)

      clock.advance(50)
      tick()
      clock.advance(50)
      tick()

      latest = lastGlobalTrack(globalEvents)
      expect(latest.track.state).to.equal('tentative')
      expect(latest.meta.snapshotChangedThisTick).to.equal(false)

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1210,
        yMm: 1410,
      })

      clock.advance(50)
      tick()

      latest = lastGlobalTrack(globalEvents)
      expect(latest.track.state).to.equal('confirmed')
      expect(latest.meta.snapshotChangedThisTick).to.equal(true)

      pipeline.dispose()
      unsub()
    })
  })

  it('uses rolling confirmation window by resetting tentative streak after window expiry', async function () {
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
          confirmEnabled: true,
          confirmCount: 2,
          confirmWindowMs: 100,
        }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1200,
        yMm: 1400,
      })

      clock.advance(50)
      tick()

      let latest = lastGlobalTrack(globalEvents)
      expect(latest.track).to.not.equal(null)
      expect(latest.track.state).to.equal('tentative')

      clock.advance(150)
      tick()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1210,
        yMm: 1410,
      })

      clock.advance(50)
      tick()

      latest = lastGlobalTrack(globalEvents)
      expect(latest.track.state).to.equal('tentative')

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1220,
        yMm: 1420,
      })

      clock.advance(50)
      tick()

      latest = lastGlobalTrack(globalEvents)
      expect(latest.track.state).to.equal('confirmed')

      pipeline.dispose()
      unsub()
    })
  })

  it('reports processing freshness and measurement freshness separately', async function () {
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
        controllerConfig: makeConfig({ confirmEnabled: false }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        measTs: clock.nowMs() - 300,
        xMm: 1200,
        yMm: 1400,
      })

      clock.advance(50)
      tick()

      const latest = lastGlobalTrack(globalEvents)
      expect(latest.track).to.not.equal(null)
      expect(Number(latest.track.lastSeenMs)).to.equal(0)
      expect(Number(latest.track.lastMeasAgeMs)).to.equal(350)

      pipeline.dispose()
      unsub()
    })
  })

  it('in passthrough mode keeps lastSeenMs as processing freshness and lastMeasAgeMs as sensor freshness', async function () {
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
        controllerConfig: makeConfig({ mode: 'passthrough', confirmEnabled: false }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        measTs: clock.nowMs() - 300,
        xMm: 1200,
        yMm: 1400,
      })

      clock.advance(50)
      tick()

      const latest = lastGlobalTrack(globalEvents)
      expect(latest.track).to.not.equal(null)
      expect(Number(latest.track.lastSeenMs)).to.equal(0)
      expect(Number(latest.track.lastMeasAgeMs)).to.equal(350)

      pipeline.dispose()
      unsub()
    })
  })

  it('uses per-track predict time so no dt over-integration between measurement updates', async function () {
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
        controllerConfig: makeConfig({ confirmEnabled: false }),
      })

      pipeline.start()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1000,
        yMm: 2000,
      })

      clock.advance(50)
      tick()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 1600,
        yMm: 2000,
      })

      clock.advance(50)
      tick()

      publishLd2450Track({
        bus: presenceInternalBus,
        now: clock.nowMs(),
        xMm: 2200,
        yMm: 2000,
      })

      clock.advance(50)
      tick()

      const xs = []
      for (let i = 0; i < 3; i += 1) {
        clock.advance(50)
        tick()
        const latest = lastGlobalTrack(globalEvents)
        expect(latest.track).to.not.equal(null)
        xs.push(Number(latest.track.xMm))
      }

      const d1 = xs[1] - xs[0]
      const d2 = xs[2] - xs[1]

      expect(d1).to.be.greaterThan(0)
      expect(d2).to.be.at.most((d1 * 1.25) + 2)

      pipeline.dispose()
      unsub()
    })
  })
})
