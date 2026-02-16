// src/domains/presence/tracking/snapshot/radarSnapshotBuffer.js

const clamp01 = function clamp01(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export class RadarSnapshotBuffer {
  #clock
  #cfg

  #latestByRadarId = new Map()
  #bufferByRadarId = new Map()

  #radarsExpectedSet
  #radarsSeenEver = new Set()
  #lastTickMeasTsByRadarId = new Map()

  #stuckTicks = 0

  constructor({ clock, cfg }) {
    this.#clock = clock
    this.#cfg = cfg || {}

    this.#radarsExpectedSet = this.#buildExpectedRadarIdSet()
  }

  dispose() {
    this.#latestByRadarId.clear()
    this.#bufferByRadarId.clear()
    this.#radarsSeenEver.clear()
    this.#lastTickMeasTsByRadarId.clear()
    this.#stuckTicks = 0
  }

  ingestEntry(radarId, entry, now) {
    const rid = Number(radarId)
    if (!Number.isFinite(rid)) return

    const maxFrames = this.#getRadarBufferMaxFrames()
    const windowMs = this.#getRadarBufferWindowMs()

    const buf = this.#bufferByRadarId.get(rid) || []
    buf.push(entry)

    const cutoffTs = now - windowMs
    let keep = buf.filter((e) => Number(e?.measTs) >= cutoffTs)

    if (maxFrames > 0 && keep.length > maxFrames) {
      keep = keep.slice(keep.length - maxFrames)
    }

    this.#bufferByRadarId.set(rid, keep)

    this.#latestByRadarId.set(rid, entry)
    this.#radarsSeenEver.add(rid)
  }

  getLatestMeasTs(radarId) {
    const rid = Number(radarId)
    if (!Number.isFinite(rid)) return 0

    const latest = this.#latestByRadarId.get(rid) || null
    const ts = Number(latest?.measTs) || 0
    return Number.isFinite(ts) ? ts : 0
  }

  cleanup(now) {
    this.#cleanupRadarBuffers(now)
  }

  makeSnapshot(now, { debugEnabled }) {
    const staleMeasMaxMs = this.#getStaleMeasMaxMs()
    const radarMissingTimeoutMs = this.#getRadarMissingTimeoutMs()

    const jitterDelayMs = this.#getJitterDelayMs()
    let sampleTs = now - jitterDelayMs

    const waitForAll = this.#getWaitForAllEnabled()
    const waitTimeoutMs = this.#getWaitForAllTimeoutMs()

    if (waitForAll) {
      let minLatest = Infinity
      let haveAny = false

      const expectedIds = this.#radarsExpectedSet.size > 0
        ? [...this.#radarsExpectedSet.values()].sort((a, b) => a - b)
        : [...this.#latestByRadarId.keys()].sort((a, b) => a - b)

      for (const rid of expectedIds) {
        const latest = this.#latestByRadarId.get(rid)
        const ts = Number(latest?.measTs)
        if (!Number.isFinite(ts) || ts <= 0) continue
        haveAny = true
        minLatest = Math.min(minLatest, ts)
      }

      if (haveAny && Number.isFinite(minLatest)) {
        const maxBack = now - waitTimeoutMs
        sampleTs = Math.max(minLatest, maxBack)
      }
    }

    const expected = this.#radarsExpectedSet
    const expectedCount = expected.size
    const seenTotal = this.#radarsSeenEver.size

    let radarsFresh = 0
    let radarsStale = 0
    let radarsMissing = 0

    let maxRadarAgeMs = 0
    let minRadarAgeMs = Infinity
    let maxRecvLagMs = 0

    let framesFreshWithDetections = 0
    let measIn = 0

    let snapshotsAdvancedThisTick = false
    let radarsAdvancedCount = 0

    const observations = []
    const radars = []

    const debugRadars = debugEnabled ? [] : null

    const expectedIds = expectedCount > 0
      ? [...expected.values()].sort((a, b) => a - b)
      : [...this.#latestByRadarId.keys()].sort((a, b) => a - b)
    const expectedSet = expectedCount > 0 ? expected : null
    const selectedMeasTsByRadarId = new Map()

    for (const radarId of expectedIds) {
      const entry = this.#selectRadarEntry(radarId, sampleTs)

      if (!entry) {
        selectedMeasTsByRadarId.set(radarId, null)
        radarsMissing += 1

        radars.push({
          radarId,
          status: 'missing',
          included: false,
          advanced: false,
          measTs: null,
          recvTs: null,
          ageMs: null,
          recvLagMs: null,
          detectionCount: 0,
          slotCount: null,
          publishAs: null,
          zoneId: null,
        })

        if (debugEnabled) {
          debugRadars.push({
            radarId,
            publishAs: null,
            zoneId: null,
            enabled: expectedSet ? true : null,
            status: 'missing',
            included: false,
            advanced: false,
            measTs: null,
            ageMs: null,
            recvTs: null,
            recvLagMs: null,
            detectionCount: 0,
            slotCount: null,
            ingestDebug: null,
          })
        }

        continue
      }

      const measTs = Number(entry.measTs) || 0
      const recvTs = Number(entry.recvTs) || 0
      selectedMeasTsByRadarId.set(radarId, measTs)

      const ageMs = Math.max(0, now - measTs)
      const recvLagMs = (recvTs && measTs) ? Math.max(0, recvTs - measTs) : 0

      const lastTickMeasTs = Number(this.#lastTickMeasTsByRadarId.get(radarId)) || 0
      const advanced = measTs > lastTickMeasTs

      if (advanced) {
        snapshotsAdvancedThisTick = true
        radarsAdvancedCount += 1
      }

      let status = 'fresh'
      let included = true

      if (ageMs > radarMissingTimeoutMs) {
        status = 'missing'
        included = false
        radarsMissing += 1
      } else if (ageMs > staleMeasMaxMs) {
        status = 'stale'
        included = false
        radarsStale += 1
      } else {
        radarsFresh += 1
      }

      radars.push({
        radarId,
        status,
        included,
        advanced,
        measTs,
        recvTs: recvTs || null,
        ageMs,
        recvLagMs,
        detectionCount: Number(entry.detectionCount) || 0,
        slotCount: Number(entry.slotCount) || null,
        publishAs: entry.publishAs ?? null,
        zoneId: entry.zoneId ?? null,
      })

      if (included) {
        maxRadarAgeMs = Math.max(maxRadarAgeMs, ageMs)
        minRadarAgeMs = Math.min(minRadarAgeMs, ageMs)
        maxRecvLagMs = Math.max(maxRecvLagMs, recvLagMs)

        const detCount = Number(entry.detectionCount) || 0
        if (detCount > 0) framesFreshWithDetections += 1

        measIn += detCount
        if (Array.isArray(entry.measurements) && entry.measurements.length > 0) {
          observations.push(...entry.measurements)
        }
      }

      if (debugEnabled) {
        debugRadars.push({
          radarId,
          publishAs: entry.publishAs ?? null,
          zoneId: entry.zoneId ?? null,
          enabled: expectedSet ? true : null,
          status,
          included,
          advanced,
          measTs,
          ageMs,
          recvTs: recvTs || null,
          recvLagMs,
          detectionCount: Number(entry.detectionCount) || 0,
          slotCount: Number(entry.slotCount) || null,
          ingestDebug: entry.debug?.ingestDebug ?? null,
        })
      }
    }

    if (!Number.isFinite(minRadarAgeMs)) minRadarAgeMs = 0

    for (const [radarId, measTsRaw] of selectedMeasTsByRadarId.entries()) {
      const measTs = Number(measTsRaw) || 0
      const lastTickMeasTs = Number(this.#lastTickMeasTsByRadarId.get(radarId)) || 0
      if (measTs > lastTickMeasTs) {
        this.#lastTickMeasTsByRadarId.set(radarId, measTs)
      }
    }

    const snapshotKey = expectedIds
      .map((radarId) => {
        const measTs = Number(selectedMeasTsByRadarId.get(radarId))
        return Number.isFinite(measTs) && measTs > 0
          ? `${radarId}:${Math.floor(measTs)}`
          : `${radarId}:na`
      })
      .join('|')

    if (expectedCount > 0 && radarsAdvancedCount === 0) {
      this.#stuckTicks += 1
    } else {
      this.#stuckTicks = 0
    }

    const stuckN = Number(this.#cfg?.tracking?.snapshot?.stuckTicksWarn ?? 20)
    const stuck = Number.isFinite(stuckN) && stuckN > 0
      ? this.#stuckTicks >= stuckN
      : (this.#stuckTicks >= 20)

    const meta = {
      tickIntervalMs: this.#getUpdateIntervalMs(),
      staleMeasMaxMs,
      radarMissingTimeoutMs,

      jitterDelayMs,
      sampleTs,
      snapshotKey,
      waitForAll: waitForAll || null,
      waitForAllTimeoutMs: waitForAll ? waitTimeoutMs : null,

      radarsExpected: expectedCount || null,
      radarsSeenTotal: seenTotal,

      radarsFresh,
      radarsStale,
      radarsMissing,

      framesFreshUsed: radarsFresh,
      framesFreshWithDetections,

      measIn,

      maxRadarAgeMs,
      minRadarAgeMs,
      maxRecvLagMs,

      snapshotsAdvancedThisTick,
      radarsAdvancedCount,

      stuckTicks: this.#stuckTicks,
      stuck,
    }

    const debug = debugEnabled ? { radars: debugRadars } : null

    return { observations, radars, meta, debug }
  }

  #selectRadarEntry(radarId, sampleTs) {
    const buf = this.#bufferByRadarId.get(radarId)
    if (!Array.isArray(buf) || buf.length === 0) return null

    let best = null
    for (let i = buf.length - 1; i >= 0; i -= 1) {
      const e = buf[i]
      const ts = Number(e?.measTs)
      if (!Number.isFinite(ts)) continue

      if (ts <= sampleTs) {
        best = e
        break
      }
    }

    if (!best) best = buf[buf.length - 1]

    return best || null
  }

  #cleanupRadarBuffers(now) {
    const windowMs = this.#getRadarBufferWindowMs()
    const ttlMs = windowMs * 2

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    const cutoffTs = now - ttlMs

    for (const [rid, buf] of this.#bufferByRadarId.entries()) {
      if (!Array.isArray(buf) || buf.length === 0) {
        this.#bufferByRadarId.delete(rid)
        continue
      }

      const keep = buf.filter((e) => {
        const ts = Number(e?.measTs)
        return Number.isFinite(ts) && ts >= cutoffTs
      })

      if (keep.length === 0) {
        this.#bufferByRadarId.delete(rid)
        continue
      }

      this.#bufferByRadarId.set(rid, keep)
    }
  }

  #getUpdateIntervalMs() {
    const ms = Number(this.#cfg?.tracking?.updateIntervalMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 50
  }

  #getJitterDelayMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.jitterDelayMs)
    if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
    return 0
  }

  #getRadarBufferMaxFrames() {
    const n = Number(this.#cfg?.tracking?.snapshot?.radarBufferMaxFrames)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
    return 5
  }

  #getRadarBufferWindowMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.radarBufferWindowMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 4000
  }

  #getWaitForAllEnabled() {
    return this.#cfg?.tracking?.snapshot?.waitForAll?.enabled === true
  }

  #getWaitForAllTimeoutMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.waitForAll?.timeoutMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 120
  }

  #getStaleMeasMaxMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.staleMeasMaxMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 250
  }

  #getRadarMissingTimeoutMs() {
    const ms = Number(this.#cfg?.tracking?.snapshot?.radarMissingTimeoutMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 1500
  }

  #buildExpectedRadarIdSet() {
    const set = new Set()

    const layout = this.#cfg?.layout || {}
    const list = Array.isArray(layout?.ld2450) ? layout.ld2450 : []

    for (let radarId = 0; radarId < list.length; radarId += 1) {
      const entry = list[radarId]
      if (!entry) continue
      if (entry.enabled !== true) continue
      set.add(radarId)
    }

    return set
  }
}

export default RadarSnapshotBuffer
