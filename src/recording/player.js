// src/recording/player.js
import { validateRecording } from './recordingFormat.js'
import { isPlainObject } from '../utils/isPlainObject.js'

const graceMs = 3
const maxDispatchPerSchedule = 1000

const parseStreamKey4 = (streamKey) => {
  const s = String(streamKey || '').trim()
  if (!s) return null

  const parts = s.split('::')
  if (parts.length < 3) return null

  // canonical: who::what::where::why
  // but match ignores why -> match who/what/where
  const who = String(parts[0] || '').trim()
  const what = String(parts[1] || '').trim()

  const where = (parts.length >= 4)
    ? String(parts[2] || '').trim()
    : String(parts[2] || '').trim()

  const why = (parts.length >= 4)
    ? String(parts[3] || '').trim()
    : null

  if (!who || !what || !where) return null
  return { who, what, where, why }
}

const patternToParts3 = (pattern) => {
  const s = String(pattern || '').trim()
  if (!s) return null

  const parts = s.split('::')
  if (parts.length < 3) return null

  const who = String(parts[0] || '').trim()
  const what = String(parts[1] || '').trim()
  const where = String(parts[2] || '').trim()

  if (!who || !what || !where) return null
  return { who, what, where }
}

const matchSegment = (pattern, value) => {
  const p = String(pattern || '')
  const v = String(value || '')

  let pi = 0
  let vi = 0
  let star = -1
  let starVi = -1

  while (vi < v.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === v[vi])) {
      pi += 1
      vi += 1
      continue
    }

    if (pi < p.length && p[pi] === '*') {
      star = pi
      starVi = vi
      pi += 1
      continue
    }

    if (star !== -1) {
      pi = star + 1
      starVi += 1
      vi = starVi
      continue
    }

    return false
  }

  while (pi < p.length && p[pi] === '*') pi += 1
  return pi === p.length
}

const matchStreamKey3 = ({ pattern, streamKey }) => {
  const p = patternToParts3(pattern)
  const sk = parseStreamKey4(streamKey)
  if (!p || !sk) return false

  if (!matchSegment(p.who, sk.who)) return false
  if (!matchSegment(p.what, sk.what)) return false
  if (!matchSegment(p.where, sk.where)) return false

  return true
}

const normalizeRoutingByStreamKey = (routingByStreamKey) => {
  const r = isPlainObject(routingByStreamKey) ? routingByStreamKey : null
  if (!r) {
    const err = new Error('missing_routingByStreamKey')
    err.code = 'BAD_REQUEST'
    throw err
  }

  const rules = []
  for (const [k, v] of Object.entries(r)) {
    const pattern = String(k || '').trim()
    const sink = String(v || '').trim()

    if (!pattern || !sink) continue
    rules.push({ pattern, sink })
  }

  if (!rules.length) {
    const err = new Error('empty_routingByStreamKey')
    err.code = 'BAD_REQUEST'
    throw err
  }

  return rules
}

const resolveSink = ({ streamKey, rules }) => {
  for (const r of rules) {
    if (matchStreamKey3({ pattern: r.pattern, streamKey })) {
      return r.sink
    }
  }

  return 'discard'
}

const normalizeInterval = ({ interval, maxIndex }) => {
  if (!interval) return null

  if (!Array.isArray(interval) || interval.length !== 2) {
    const err = new Error('invalid_interval')
    err.code = 'BAD_REQUEST'
    throw err
  }

  const a = Number(interval[0])
  const b = Number(interval[1])

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    const err = new Error('invalid_interval_bounds')
    err.code = 'BAD_REQUEST'
    throw err
  }

  const fromRaw = Math.floor(a)
  const toRaw = Math.floor(b)

  const from = Math.max(0, Math.min(maxIndex, fromRaw))
  const to = Math.max(0, Math.min(maxIndex, toRaw))

  if (from > to) {
    const err = new Error('interval_from_gt_to')
    err.code = 'BAD_REQUEST'
    throw err
  }

  return { from, to }
}

export class Player {
  #logger
  #deviceManager
  #buses
  #nowMs
  #setTimeout
  #clearTimeout

  #recording
  #events
  #streamsObserved

  #state
  #speed

  #timer
  #nextPos

  #baseRealMs
  #baseLogicalMs

  #stats

  #routingRules
  #rewriteTs

  #isolation
  #blockToken

  #interval

  constructor({ logger, deviceManager, buses, nowMs, setTimeoutFn, clearTimeoutFn }) {
    this.#logger = logger
    this.#deviceManager = deviceManager
    this.#buses = buses || {}

    this.#nowMs = typeof nowMs === 'function' ? nowMs : () => Date.now()
    this.#setTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout
    this.#clearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout

    this.#recording = null
    this.#events = []
    this.#streamsObserved = {}

    this.#state = 'idle'
    this.#speed = 1

    this.#timer = null
    this.#nextPos = 0

    this.#baseRealMs = 0
    this.#baseLogicalMs = 0

    this.#stats = {
      dispatched: 0,
      injected: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      lastError: null,

      lateTotal: 0,
      lateMsTotal: 0,
      lateMsMax: 0,
    }

    this.#routingRules = []
    this.#rewriteTs = false

    this.#isolation = null
    this.#blockToken = null

    this.#interval = null
  }

  load(recording) {
    const v = validateRecording(recording)
    if (!v.ok) {
      const err = new Error(v.message || v.error || 'invalid_recording')
      err.code = v.error || 'INVALID_RECORDING'
      throw err
    }

    this.stop()

    this.#recording = recording
    this.#events = Array.isArray(recording.events) ? recording.events : []
    this.#streamsObserved = isPlainObject(recording.streamsObserved) ? recording.streamsObserved : {}

    this.#state = 'loaded'
    this.#nextPos = 0

    this.#stats = {
      dispatched: 0,
      injected: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      lastError: null,

      lateTotal: 0,
      lateMsTotal: 0,
      lateMsMax: 0,
    }
  }

  start({ speed = 1, routingByStreamKey, rewriteTs = false, isolation, interval } = {}) {
    if (!this.#recording) {
      const err = new Error('recording_not_loaded')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (this.#state === 'playing') return

    const s = Number(speed)
    if (Number.isNaN(s) || s <= 0) {
      const err = new Error('invalid_speed')
      err.code = 'BAD_REQUEST'
      throw err
    }

    this.#routingRules = normalizeRoutingByStreamKey(routingByStreamKey)
    this.#rewriteTs = rewriteTs === true

    this.#isolation = isPlainObject(isolation) ? { ...isolation } : null

    const maxIndex = this.#events.length
      ? Math.max(...this.#events.map((e) => Number.isFinite(e?.i) ? e.i : -1))
      : -1

    this.#interval = (maxIndex >= 0)
      ? normalizeInterval({ interval, maxIndex })
      : null

    this.#maybeBlockDevices()

    this.#speed = s
    this.#state = 'playing'

    this.#baseRealMs = this.#nowMs()
    this.#baseLogicalMs = 0

    this.#scheduleNext()
  }

  pause() {
    if (this.#state !== 'playing') return

    this.#baseLogicalMs = this.#logicalNowMs()
    this.#baseRealMs = 0

    this.#clearTimer()
    this.#state = 'paused'
  }

  resume({ speed } = {}) {
    if (this.#state !== 'paused') return

    if (speed !== undefined) {
      this.setSpeed({ speed })
    }

    this.#baseRealMs = this.#nowMs()
    this.#state = 'playing'

    this.#scheduleNext()
  }

  setSpeed({ speed }) {
    const s = Number(speed)
    if (Number.isNaN(s) || s <= 0) {
      const err = new Error('invalid_speed')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (this.#state === 'playing') {
      this.#baseLogicalMs = this.#logicalNowMs()
      this.#baseRealMs = this.#nowMs()

      this.#clearTimer()
      this.#speed = s

      this.#scheduleNext()
      return
    }

    this.#speed = s
  }

  stop() {
    this.#clearTimer()
    this.#maybeUnblockDevices()

    this.#state = this.#recording ? 'loaded' : 'idle'
    this.#nextPos = 0

    this.#baseRealMs = 0
    this.#baseLogicalMs = 0
  }

  getSnapshot() {
    const total = this.#events.length
    const pos = this.#nextPos

    const positionMs = this.#state === 'playing'
      ? this.#logicalNowMs()
      : this.#baseLogicalMs

    const totalMs = total > 0 ? this.#events[total - 1].tMs : 0

    return {
      state: this.#state,
      speed: this.#speed,
      totalEvents: total,
      nextPos: pos,
      positionMs,
      totalMs,

      dispatched: this.#stats.dispatched,
      injected: this.#stats.injected,
      published: this.#stats.published,
      skipped: this.#stats.skipped,
      failed: this.#stats.failed,
      lastError: this.#stats.lastError,

      lateTotal: this.#stats.lateTotal,
      lateMsTotal: this.#stats.lateMsTotal,
      lateMsMax: this.#stats.lateMsMax,

      rewriteTs: this.#rewriteTs,
      interval: this.#interval ? { ...this.#interval } : null,

      routingByStreamKey: this.#routingRules.map((r) => ({ ...r })),
      isolation: this.#blockToken ? { token: this.#blockToken } : null,
    }
  }

  #logicalNowMs() {
    if (this.#state !== 'playing') return this.#baseLogicalMs

    const now = this.#nowMs()
    const elapsedReal = now - this.#baseRealMs
    const logical = this.#baseLogicalMs + (elapsedReal * this.#speed)

    return logical < 0 ? 0 : logical
  }

  #clearTimer() {
    if (!this.#timer) return
    this.#clearTimeout(this.#timer)
    this.#timer = null
  }

  #inInterval(ev) {
    if (!this.#interval) return true

    const i = Number(ev?.i)
    if (!Number.isFinite(i)) return false

    return i >= this.#interval.from && i <= this.#interval.to
  }

  #noteLateness(ev) {
    const tMs = Number(ev?.tMs)
    if (!Number.isFinite(tMs)) return

    const lateRaw = Math.max(0, this.#logicalNowMs() - tMs)

    // always track max lateness, even if under grace
    this.#stats.lateMsMax = Math.max(this.#stats.lateMsMax, lateRaw)

    if (lateRaw > graceMs) {
      this.#stats.lateTotal += 1
      this.#stats.lateMsTotal += lateRaw
    }
  }

  #scheduleNext() {
    if (this.#state !== 'playing') return

    let dispatchedThisCall = 0

    while (this.#nextPos < this.#events.length) {
      const logicalNow = this.#logicalNowMs()

      // drain all due events (including same tMs)
      while (this.#nextPos < this.#events.length) {
        const ev = this.#events[this.#nextPos]

        if (!this.#inInterval(ev)) {
          this.#nextPos += 1
          this.#stats.skipped += 1
          continue
        }

        const dt = ev.tMs - logicalNow
        if (dt > 0) break

        this.#nextPos += 1
        this.#noteLateness(ev)
        this.#dispatch(ev)

        dispatchedThisCall += 1
        if (dispatchedThisCall >= maxDispatchPerSchedule) {
          this.#timer = this.#setTimeout(() => {
            this.#timer = null
            this.#scheduleNext()
          }, 0)

          return
        }
      }

      if (this.#nextPos >= this.#events.length) break

      const evNext = this.#events[this.#nextPos]

      // if next is out of interval, loop and count it as skipped in the drain
      if (!this.#inInterval(evNext)) continue

      const dtNext = evNext.tMs - logicalNow
      const delayReal = Math.ceil(dtNext / this.#speed)

      this.#timer = this.#setTimeout(() => {
        this.#timer = null
        this.#scheduleNext()
      }, Math.max(0, delayReal))

      return
    }

    this.#state = 'loaded'
    if (this.#isolation?.unblockOnStop === true) {
      this.#maybeUnblockDevices()
    }
  }

  #dispatch(ev) {
    this.#stats.dispatched += 1

    const raw0 = ev?.raw
    const streamKey = String(raw0?.streamKey || '').trim()
    if (!streamKey) {
      this.#stats.failed += 1
      this.#stats.lastError = 'MISSING_STREAMKEY'
      return
    }

    const sink = resolveSink({ streamKey, rules: this.#routingRules })
    if (sink === 'discard') {
      this.#stats.skipped += 1
      return
    }

    if (sink === 'device') {
      return this.#dispatchToDevice({ raw: raw0, streamKey })
    }

    if (sink === 'bus') {
      return this.#dispatchToBus({ raw: raw0, streamKey })
    }

    this.#stats.failed += 1
    this.#stats.lastError = 'UNKNOWN_SINK'
    this.#logger?.warning?.('player_unknown_sink', { sink, streamKey })
  }

  #dispatchToDevice({ raw, streamKey }) {
    const payload = raw?.payload
    const publishAs = String(payload?.publishAs || '').trim()

    if (!publishAs) {
      this.#stats.failed += 1
      this.#stats.lastError = 'MISSING_PUBLISHAS'
      this.#logger?.warning?.('player_missing_publishAs', { streamKey })
      return
    }

    const resolver = this.#deviceManager?.resolveDeviceIdByPublishAs
    const deviceId = typeof resolver === 'function'
      ? String(resolver.call(this.#deviceManager, publishAs) || '').trim()
      : ''

    if (!deviceId) {
      this.#stats.skipped += 1
      this.#logger?.warning?.('player_publishAs_not_resolved', { publishAs, streamKey })
      return
    }

    try {
      const out = this.#deviceManager.inject(deviceId, payload)
      if (!out?.ok) {
        this.#stats.failed += 1
        this.#stats.lastError = out?.error || 'INJECT_FAILED'

        this.#logger?.warning?.('player_inject_failed', {
          deviceId,
          publishAs,
          streamKey,
          error: out?.error,
          message: out?.message,
        })

        return
      }

      this.#stats.injected += 1
    } catch (e) {
      this.#stats.failed += 1
      this.#stats.lastError = e?.code || 'INJECT_THROW'

      this.#logger?.warning?.('player_inject_throw', {
        deviceId,
        publishAs,
        streamKey,
        error: e?.message || String(e),
      })
    }
  }

  #dispatchToBus({ raw, streamKey }) {
    const meta = this.#streamsObserved?.[streamKey]
    const busId = String(meta?.bus || '').trim()

    if (!busId) {
      this.#stats.failed += 1
      this.#stats.lastError = 'MISSING_STREAM_OBSERVED_BUS'
      this.#logger?.warning?.('player_missing_stream_bus', { streamKey })
      return
    }

    const bus = this.#buses?.[busId]
    if (!bus || typeof bus.publish !== 'function') {
      this.#stats.failed += 1
      this.#stats.lastError = 'BUS_NOT_FOUND'
      this.#logger?.warning?.('player_bus_not_found', { busId, streamKey })
      return
    }

    const out = this.#rewriteTs
      ? { ...raw, ts: this.#nowMs() }
      : raw

    try {
      bus.publish(out)
      this.#stats.published += 1
    } catch (e) {
      this.#stats.failed += 1
      this.#stats.lastError = e?.code || 'BUS_PUBLISH_THROW'
      this.#logger?.warning?.('player_bus_publish_throw', { busId, streamKey, error: e?.message || String(e) })
    }
  }

  #maybeBlockDevices() {
    if (!this.#isolation) return
    if (!this.#deviceManager?.blockDevices) return

    const blockCfg = this.#isolation.blockDevices
    if (blockCfg !== true && !Array.isArray(blockCfg)) return

    const owner = String(this.#isolation.owner || '').trim() || 'recordingPlayer'
    const reason = String(this.#isolation.reason || '').trim() || 'playback'

    const publishAsSet = new Set()

    if (blockCfg === true) {
      for (const ev of this.#events) {
        if (!this.#inInterval(ev)) continue

        const raw = ev?.raw
        const streamKey = String(raw?.streamKey || '').trim()
        if (!streamKey) continue

        const sink = resolveSink({ streamKey, rules: this.#routingRules })
        if (sink !== 'device') continue

        const publishAs = String(raw?.payload?.publishAs || '').trim()
        if (publishAs) publishAsSet.add(publishAs)
      }
    } else {
      for (const x of blockCfg) {
        const p = String(x || '').trim()
        if (p) publishAsSet.add(p)
      }
    }

    const publishAsArr = [...publishAsSet]
    if (!publishAsArr.length) return

    const resolver = this.#deviceManager?.resolveDeviceIdByPublishAs
    const ids = []

    for (const publishAs of publishAsArr) {
      const deviceId = typeof resolver === 'function'
        ? String(resolver.call(this.#deviceManager, publishAs) || '').trim()
        : ''

      if (!deviceId) {
        this.#logger?.warning?.('player_block_publishAs_not_resolved', { publishAs })
        continue
      }

      ids.push(deviceId)
    }

    if (!ids.length) return

    try {
      const res = this.#deviceManager.blockDevices({ deviceIds: ids, reason, owner })
      if (res?.ok && res?.token) {
        this.#blockToken = res.token
      }
    } catch (e) {
      this.#logger?.warning?.('player_block_devices_throw', { error: e?.message || String(e) })
    }
  }

  #maybeUnblockDevices() {
    if (!this.#blockToken) return
    if (!this.#deviceManager?.unblockDevices) return

    const token = this.#blockToken
    this.#blockToken = null

    try {
      this.#deviceManager.unblockDevices({ token })
    } catch (e) {
      this.#logger?.warning?.('player_unblock_devices_throw', { error: e?.message || String(e) })
    }
  }
}

export default Player
