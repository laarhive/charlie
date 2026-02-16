// test/unit/radarSnapshotBuffer.spec.js
import { expect } from 'chai'
import RadarSnapshotBuffer from '../../src/domains/presence/tracking/snapshot/radarSnapshotBuffer.js'

const makeClock = function makeClock(startMs = 0) {
  let now = startMs
  return {
    nowMs: () => now,
    advance: (ms) => { now += Number(ms) || 0 },
  }
}

const makeConfig = function makeConfig({
  layout = [{ publishAs: 'LD2450A', enabled: true }],
  snapshot = {},
} = {}) {
  const waitForAll = {
    enabled: false,
    timeoutMs: 120,
    ...(snapshot.waitForAll || {}),
  }

  return {
    layout: { ld2450: layout },
    tracking: {
      updateIntervalMs: 50,
      snapshot: {
        jitterDelayMs: 0,
        radarBufferMaxFrames: 5,
        radarBufferWindowMs: 4000,
        staleMeasMaxMs: 250,
        radarMissingTimeoutMs: 1500,
        stuckTicksWarn: 20,
        ...snapshot,
        waitForAll,
      },
    },
  }
}

const makeEntry = function makeEntry({
  radarId,
  measTs,
  recvTs = measTs,
  publishAs = `LD2450${String.fromCharCode(65 + Number(radarId || 0))}`,
  zoneId = 'zone0',
  xMm = 1000,
  yMm = 1200,
  detectionCount = 1,
} = {}) {
  const measurements = []
  for (let i = 0; i < detectionCount; i += 1) {
    measurements.push({
      measTs,
      radarId,
      zoneId,
      xMm: xMm + i,
      yMm: yMm + i,
      prov: {
        publishAs,
        radarId,
        slotId: i + 1,
        measTs,
        localMm: { xMm: xMm + i, yMm: yMm + i },
      },
    })
  }

  return {
    measTs,
    recvTs,
    radarId,
    zoneId,
    publishAs,
    measurements,
    detectionCount,
    slotCount: detectionCount,
  }
}

const byRadar = function byRadar(snapshot, radarId) {
  return (snapshot.radars || []).find((r) => Number(r?.radarId) === Number(radarId)) || null
}

describe('RadarSnapshotBuffer', function () {
  it('trims per-radar history by radarBufferMaxFrames', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      snapshot: { radarBufferMaxFrames: 2, radarBufferWindowMs: 10000 },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 100 }), clock.nowMs())
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 200 }), clock.nowMs())
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 300 }), clock.nowMs())

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(byRadar(snap, 0)?.measTs).to.equal(300)
  })

  it('selects latest measTs <= sampleTs when older and newer frames are both present', function () {
    const clock = makeClock(175)
    const cfg = makeConfig({
      snapshot: { radarBufferMaxFrames: 10, radarBufferWindowMs: 10000 },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 100 }), 100)
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 250 }), 175)

    const snap = buf.makeSnapshot(175, { debugEnabled: false })
    expect(byRadar(snap, 0)?.measTs).to.equal(100)
  })

  it('applies radarBufferWindowMs cutoff during ingestEntry(now)', function () {
    const clock = makeClock(400)
    const cfg = makeConfig({
      snapshot: { radarBufferMaxFrames: 10, radarBufferWindowMs: 100 },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    // At now=400 and window=100, cutoff is 300 -> this entry is dropped immediately.
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 100 }), 400)
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 350 }), 400)

    const snap = buf.makeSnapshot(400, { debugEnabled: false })
    expect(byRadar(snap, 0)?.measTs).to.equal(350)
  })

  it('uses jitterDelayMs sampling to pick the newest frame <= sampleTs', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      snapshot: {
        jitterDelayMs: 40,
        radarBufferMaxFrames: 5,
        radarBufferWindowMs: 4000,
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), clock.nowMs())
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 980 }), clock.nowMs())

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap.meta.sampleTs).to.equal(960)
    expect(byRadar(snap, 0)?.measTs).to.equal(900)
  })

  it('waitForAll aligns sampleTs near the slowest expected radar timestamp', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
      ],
      snapshot: {
        staleMeasMaxMs: 500,
        radarMissingTimeoutMs: 1500,
        waitForAll: { enabled: true, timeoutMs: 110 },
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 880 }), clock.nowMs())
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 980 }), clock.nowMs())
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 900 }), clock.nowMs())

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })

    expect(snap.meta.sampleTs).to.equal(900)
    expect(byRadar(snap, 0)?.measTs).to.equal(880)
    expect(byRadar(snap, 1)?.measTs).to.equal(900)
    expect(snap.meta.snapshotKey).to.equal('0:880|1:900')
  })

  it('classifies radars as fresh/stale/missing at threshold boundaries', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
        { publishAs: 'LD2450C', enabled: true },
        { publishAs: 'LD2450D', enabled: true },
      ],
      snapshot: {
        staleMeasMaxMs: 100,
        radarMissingTimeoutMs: 300,
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), clock.nowMs()) // age=100 -> fresh
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 899 }), clock.nowMs()) // age=101 -> stale
    buf.ingestEntry(2, makeEntry({ radarId: 2, measTs: 700 }), clock.nowMs()) // age=300 -> stale
    buf.ingestEntry(3, makeEntry({ radarId: 3, measTs: 699 }), clock.nowMs()) // age=301 -> missing

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })

    expect(byRadar(snap, 0)?.status).to.equal('fresh')
    expect(byRadar(snap, 1)?.status).to.equal('stale')
    expect(byRadar(snap, 2)?.status).to.equal('stale')
    expect(byRadar(snap, 3)?.status).to.equal('missing')

    expect(snap.meta.radarsFresh).to.equal(1)
    expect(snap.meta.radarsStale).to.equal(2)
    expect(snap.meta.radarsMissing).to.equal(1)
    expect(snap.meta.framesFreshUsed).to.equal(1)
    expect(snap.meta.measIn).to.equal(1)
  })

  it('builds deterministic snapshotKey with sorted radar IDs and na for missing', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
        { publishAs: 'LD2450C', enabled: true },
      ],
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(2, makeEntry({ radarId: 2, measTs: 950 }), clock.nowMs())
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), clock.nowMs())

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap.meta.snapshotKey).to.equal('0:900|1:na|2:950')
  })

  it('tracks snapshotsAdvancedThisTick and radarsAdvancedCount from selected timestamps', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
      ],
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), clock.nowMs())
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 900 }), clock.nowMs())

    const snap1 = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap1.meta.snapshotsAdvancedThisTick).to.equal(true)
    expect(snap1.meta.radarsAdvancedCount).to.equal(2)

    const snap2 = buf.makeSnapshot(1050, { debugEnabled: false })
    expect(snap2.meta.snapshotsAdvancedThisTick).to.equal(false)
    expect(snap2.meta.radarsAdvancedCount).to.equal(0)

    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 950 }), 1050)
    const snap3 = buf.makeSnapshot(1100, { debugEnabled: false })
    expect(snap3.meta.snapshotsAdvancedThisTick).to.equal(true)
    expect(snap3.meta.radarsAdvancedCount).to.equal(1)
  })

  it('does not advance snapshot key or advanced counters on duplicate measTs', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
      ],
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), 1000)
    const snap1 = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap1.meta.snapshotKey).to.equal('0:900')
    expect(snap1.meta.snapshotsAdvancedThisTick).to.equal(true)
    expect(snap1.meta.radarsAdvancedCount).to.equal(1)

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), 1050)
    const snap2 = buf.makeSnapshot(1050, { debugEnabled: false })
    expect(snap2.meta.snapshotKey).to.equal('0:900')
    expect(snap2.meta.snapshotsAdvancedThisTick).to.equal(false)
    expect(snap2.meta.radarsAdvancedCount).to.equal(0)
  })

  it('waitForAll timeout still advances with available radars while missing radar stays missing', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
        { publishAs: 'LD2450C', enabled: true },
      ],
      snapshot: {
        staleMeasMaxMs: 500,
        radarMissingTimeoutMs: 1500,
        waitForAll: { enabled: true, timeoutMs: 110 },
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), 900)
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 900 }), 900)
    const snap1 = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap1.meta.snapshotKey).to.equal('0:900|1:900|2:na')
    expect(snap1.meta.radarsMissing).to.equal(1)
    expect(snap1.meta.snapshotsAdvancedThisTick).to.equal(true)

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 1000 }), 1000)
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 1000 }), 1000)
    const snap2 = buf.makeSnapshot(1100, { debugEnabled: false })
    expect(snap2.meta.sampleTs).to.equal(1000)
    expect(snap2.meta.snapshotKey).to.equal('0:1000|1:1000|2:na')
    expect(snap2.meta.radarsMissing).to.equal(1)
    expect(snap2.meta.snapshotsAdvancedThisTick).to.equal(true)
  })

  it('waitForAll late arrival within timeout updates snapshotKey to include late radar measTs', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
        { publishAs: 'LD2450C', enabled: true },
      ],
      snapshot: {
        waitForAll: { enabled: true, timeoutMs: 110 },
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 1000 }), 1000)
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 1000 }), 1000)
    buf.ingestEntry(2, makeEntry({ radarId: 2, measTs: 900 }), 1000)

    const snapBeforeLate = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snapBeforeLate.meta.snapshotKey).to.equal('0:1000|1:1000|2:900')

    clock.advance(50)
    buf.ingestEntry(2, makeEntry({ radarId: 2, measTs: 1000 }), clock.nowMs())

    const snapAfterLate = buf.makeSnapshot(1050, { debugEnabled: false })
    expect(snapAfterLate.meta.sampleTs).to.equal(1000)
    expect(snapAfterLate.meta.snapshotKey).to.equal('0:1000|1:1000|2:1000')
    expect(snapAfterLate.meta.snapshotsAdvancedThisTick).to.equal(true)
    expect(snapAfterLate.meta.radarsAdvancedCount).to.equal(1)
  })

  it('increments stuckTicks only while expected radars do not advance', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      snapshot: {
        stuckTicksWarn: 2,
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 900 }), clock.nowMs())

    const snap1 = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap1.meta.stuckTicks).to.equal(0)
    expect(snap1.meta.stuck).to.equal(false)

    const snap2 = buf.makeSnapshot(1050, { debugEnabled: false })
    expect(snap2.meta.stuckTicks).to.equal(1)
    expect(snap2.meta.stuck).to.equal(false)

    const snap3 = buf.makeSnapshot(1100, { debugEnabled: false })
    expect(snap3.meta.stuckTicks).to.equal(2)
    expect(snap3.meta.stuck).to.equal(true)

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 920 }), 1100)
    const snap4 = buf.makeSnapshot(1150, { debugEnabled: false })
    expect(snap4.meta.stuckTicks).to.equal(0)
    expect(snap4.meta.stuck).to.equal(false)
  })

  it('cleanup eventually removes buffered history after long idle time', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      snapshot: {
        radarBufferWindowMs: 100,
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 700, recvTs: 700 }), 700)
    buf.cleanup(2000)

    const snap = buf.makeSnapshot(2000, { debugEnabled: false })
    expect(byRadar(snap, 0)?.status).to.equal('missing')
    expect(byRadar(snap, 0)?.measTs).to.equal(null)
  })

  it('cleanup removes stale latestByRadarId so waitForAll does not use phantom timestamps', function () {
    const clock = makeClock(2000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: true },
      ],
      snapshot: {
        radarBufferWindowMs: 400,
        waitForAll: { enabled: true, timeoutMs: 110 },
      },
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    // Radar 1 gets an old frame that will be evicted by cleanup later.
    buf.ingestEntry(1, makeEntry({ radarId: 1, measTs: 1000, recvTs: 1000 }), 1000)

    // Radar 0 has two selectable frames; sampleTs decides which one is chosen.
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 1880, recvTs: 1880 }), 2000)
    buf.ingestEntry(0, makeEntry({ radarId: 0, measTs: 1980, recvTs: 1980 }), 2000)

    buf.cleanup(2000)

    const snap = buf.makeSnapshot(2000, { debugEnabled: false })
    expect(snap.meta.sampleTs).to.equal(1980)
    expect(snap.meta.snapshotKey).to.equal('0:1980|1:na')
  })

  it('builds expected radar set from layout entries with enabled=true only', function () {
    const clock = makeClock(1000)
    const cfg = makeConfig({
      layout: [
        { publishAs: 'LD2450A', enabled: true },
        { publishAs: 'LD2450B', enabled: false },
        { publishAs: 'LD2450C', enabled: true },
      ],
    })
    const buf = new RadarSnapshotBuffer({ clock, cfg })

    const snap = buf.makeSnapshot(1000, { debugEnabled: false })
    expect(snap.meta.radarsExpected).to.equal(2)
    expect((snap.radars || []).map((r) => r.radarId)).to.deep.equal([0, 2])
    expect(snap.meta.radarsMissing).to.equal(2)
  })
})
