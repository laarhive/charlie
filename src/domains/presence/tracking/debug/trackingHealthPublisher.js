// src/domains/presence/tracking/debug/trackingHealthPublisher.js

import domainEventTypes from '../../../domainEventTypes.js'
import { makeStreamKey } from '../../../../core/eventBus.js'
import { busIds } from '../../../../app/buses.js'

export class TrackingHealthPublisher {
  #logger
  #clock
  #controllerId
  #presenceInternalBus
  #cfg
  #streamKeyWho

  #healthLastPublishTs = 0
  #healthSeq = 0
  #sanityCounters

  constructor({ logger, clock, controllerId, presenceInternalBus, cfg, streamKeyWho }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId
    this.#presenceInternalBus = presenceInternalBus
    this.#cfg = cfg || {}
    this.#streamKeyWho = streamKeyWho

    this.#sanityCounters = this.#makeEmptySanityCounters()

    if (!this.#presenceInternalBus?.publish) {
      throw new Error('TrackingHealthPublisher requires presenceInternalBus.publish')
    }
  }

  dispose() {
    this.#healthLastPublishTs = 0
    this.#healthSeq = 0
    this.#sanityCounters = this.#makeEmptySanityCounters()
  }

  noteSanity(counterKey, details) {
    if (!this.#sanityCounters[counterKey] && this.#sanityCounters[counterKey] !== 0) return

    this.#sanityCounters[counterKey] += 1
    this.#sanityCounters.last[counterKey] = {
      ts: this.#clock.nowMs(),
      ...details,
    }
  }

  computeTickLagStats(now, observations) {
    const lags = []

    for (const m of observations) {
      const ts = Number(m?.measTs)
      if (!Number.isFinite(ts) || ts <= 0) continue
      lags.push(Math.max(0, now - ts))
    }

    if (lags.length === 0) {
      return { tickLagSamples: 0, tickLagMsMax: 0, tickLagMsP95: 0 }
    }

    lags.sort((a, b) => a - b)

    return {
      tickLagSamples: lags.length,
      tickLagMsMax: lags[lags.length - 1],
      tickLagMsP95: this.#percentileFromSorted(lags, 0.95),
    }
  }

  maybePublish(now, { snapshotMeta, snapshotRadars, tickLag, meas, fusionDebug }) {
    const intervalMs = this.#getHealthIntervalMs()
    if ((now - this.#healthLastPublishTs) < intervalMs) return

    this.#healthLastPublishTs = now
    this.#healthSeq += 1

    const expected = Number(snapshotMeta?.radarsExpected) || 0
    const fresh = Number(snapshotMeta?.radarsFresh) || 0
    const stale = Number(snapshotMeta?.radarsStale) || 0
    const missing = Number(snapshotMeta?.radarsMissing) || 0

    const degraded = (expected > 0 && fresh < expected && stale === 0 && missing === 0)

    const sanity = this.#buildSanityReport({
      snapshotMeta,
      degraded,
      tickLag,
    })

    const payload = {
      ts: now,
      seq: this.#healthSeq,

      overall: {
        tickIntervalMs: snapshotMeta?.tickIntervalMs ?? null,
        staleMeasMaxMs: snapshotMeta?.staleMeasMaxMs ?? null,
        radarMissingTimeoutMs: snapshotMeta?.radarMissingTimeoutMs ?? null,

        radarsExpected: snapshotMeta?.radarsExpected ?? null,
        radarsSeenTotal: snapshotMeta?.radarsSeenTotal ?? null,

        radarsFresh: snapshotMeta?.radarsFresh ?? null,
        radarsStale: snapshotMeta?.radarsStale ?? null,
        radarsMissing: snapshotMeta?.radarsMissing ?? null,

        maxRadarAgeMs: snapshotMeta?.maxRadarAgeMs ?? null,
        maxRecvLagMs: snapshotMeta?.maxRecvLagMs ?? null,

        snapshotsAdvancedThisTick: snapshotMeta?.snapshotsAdvancedThisTick ?? null,
        radarsAdvancedCount: snapshotMeta?.radarsAdvancedCount ?? null,

        stuckTicks: snapshotMeta?.stuckTicks ?? null,
        stuck: snapshotMeta?.stuck ?? null,

        tickLagSamples: tickLag?.tickLagSamples ?? 0,
        tickLagMsP95: tickLag?.tickLagMsP95 ?? 0,
        tickLagMsMax: tickLag?.tickLagMsMax ?? 0,

        degraded,
      },

      radars: Array.isArray(snapshotRadars) ? snapshotRadars : [],

      meas: {
        measIn: meas?.measIn ?? null,
        measFiltered: meas?.measFiltered ?? null,
        measDeduped: meas?.measDeduped ?? null,
        measFused: meas?.measFused ?? null,
      },

      fusion: fusionDebug || null,

      sanity,
    }

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.trackingSnapshotHealth,
      ts: now,
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.#streamKeyWho,
        what: domainEventTypes.presence.trackingSnapshotHealth,
        where: busIds.presenceInternal,
      }),
      payload,
    })

    this.#sanityCounters = this.#makeEmptySanityCounters()
  }

  #getHealthIntervalMs() {
    const ms = Number(this.#cfg?.tracking?.health?.intervalMs)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
    return 1000
  }

  #makeEmptySanityCounters() {
    return {
      measWentBackwards: 0,
      negativeRecvLag: 0,
      recvLagHuge: 0,

      slotCountTooHigh: 0,
      detectionsGtSlots: 0,

      nonFiniteWorld: 0,

      last: {
        measWentBackwards: null,
        negativeRecvLag: null,
        recvLagHuge: null,
        slotCountTooHigh: null,
        detectionsGtSlots: null,
        nonFiniteWorld: null,
      },
    }
  }

  #buildSanityReport({ snapshotMeta, degraded, tickLag }) {
    const errors = []
    const warnings = []
    const degradedList = []

    const expected = Number(snapshotMeta?.radarsExpected) || 0
    const fresh = Number(snapshotMeta?.radarsFresh) || 0
    const adv = Number(snapshotMeta?.radarsAdvancedCount) || 0

    if (degraded) {
      degradedList.push({ code: 'PARTIAL_SNAPSHOT', details: { fresh, expected } })
    }

    if (fresh > 0 && expected > 0 && adv === 0) {
      warnings.push({ code: 'NO_ADVANCE_WHILE_FRESH', details: { fresh, expected } })
    }

    const lagP95 = Number(tickLag?.tickLagMsP95) || 0
    const tickIntervalMs = Number(snapshotMeta?.tickIntervalMs) || 0
    const lagWarnMult = Number(this.#cfg?.tracking?.health?.tickLagWarnMult ?? 2)
    const lagWarnMs = (Number.isFinite(lagWarnMult) && lagWarnMult > 0 && tickIntervalMs > 0)
      ? (lagWarnMult * tickIntervalMs)
      : 0

    if (lagWarnMs > 0 && lagP95 > lagWarnMs) {
      warnings.push({ code: 'TICK_LAG_HIGH', details: { tickLagMsP95: lagP95, warnMs: lagWarnMs } })
    }

    if (this.#sanityCounters.negativeRecvLag > 0) {
      errors.push({ code: 'NEGATIVE_RECV_LAG', count: this.#sanityCounters.negativeRecvLag, last: this.#sanityCounters.last.negativeRecvLag })
    }

    if (this.#sanityCounters.measWentBackwards > 0) {
      errors.push({ code: 'MEAS_TS_WENT_BACKWARDS', count: this.#sanityCounters.measWentBackwards, last: this.#sanityCounters.last.measWentBackwards })
    }

    if (this.#sanityCounters.recvLagHuge > 0) {
      warnings.push({ code: 'RECV_LAG_HUGE', count: this.#sanityCounters.recvLagHuge, last: this.#sanityCounters.last.recvLagHuge })
    }

    if (this.#sanityCounters.slotCountTooHigh > 0) {
      warnings.push({ code: 'SLOTCOUNT_TOO_HIGH', count: this.#sanityCounters.slotCountTooHigh, last: this.#sanityCounters.last.slotCountTooHigh })
    }

    if (this.#sanityCounters.detectionsGtSlots > 0) {
      errors.push({ code: 'DETECTIONS_GT_SLOTS', count: this.#sanityCounters.detectionsGtSlots, last: this.#sanityCounters.last.detectionsGtSlots })
    }

    if (this.#sanityCounters.nonFiniteWorld > 0) {
      errors.push({ code: 'NONFINITE_WORLD_XY', count: this.#sanityCounters.nonFiniteWorld, last: this.#sanityCounters.last.nonFiniteWorld })
    }

    return {
      error: errors,
      warn: warnings,
      degraded: degradedList,
    }
  }

  #percentileFromSorted(sortedAsc, p01) {
    if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return 0

    const p = Math.min(1, Math.max(0, Number(p01) || 0))
    const n = sortedAsc.length

    if (n === 1) return sortedAsc[0]

    const idx = Math.floor(p * (n - 1))
    return sortedAsc[Math.min(n - 1, Math.max(0, idx))]
  }
}

export default TrackingHealthPublisher
