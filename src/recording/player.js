// src/recording/player.js
import { validateRecording } from './recordingFormat.js'

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const normalizeRouting = (routing) => {
  const r = isPlainObject(routing) ? routing : {}

  const defaultSink = String(r.defaultSink || 'bus').trim() || 'bus'
  const sinksByStream = isPlainObject(r.sinksByStream) ? r.sinksByStream : {}

  const map = new Map()
  for (const [k, v] of Object.entries(sinksByStream)) {
    const stream = String(k || '').trim()
    const sink = String(v || '').trim()
    if (!stream || !sink) continue
    map.set(stream, sink)
  }

  return { defaultSink, sinksByStream: map }
}

const resolveSink = ({ stream, routing }) => {
  const by = routing?.sinksByStream
  if (by && by.has(stream)) return by.get(stream)
  return routing?.defaultSink || 'bus'
}

export class Player {
  #logger
  #deviceManager
  #nowMs
  #setTimeout
  #clearTimeout

  #recording
  #events

  #state
  #speed

  #timer
  #nextIndex

  #baseRealMs
  #baseLogicalMs

  #stats

  #routing
  #isolation
  #blockToken

  constructor({ logger, deviceManager, nowMs, setTimeoutFn, clearTimeoutFn }) {
    this.#logger = logger
    this.#deviceManager = deviceManager

    this.#nowMs = typeof nowMs === 'function' ? nowMs : () => Date.now()
    this.#setTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout
    this.#clearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout

    this.#recording = null
    this.#events = []

    this.#state = 'idle'
    this.#speed = 1

    this.#timer = null
    this.#nextIndex = 0

    this.#baseRealMs = 0
    this.#baseLogicalMs = 0

    this.#stats = {
      dispatched: 0,
      injected: 0,
      failed: 0,
      lastError: null,
    }

    this.#routing = normalizeRouting(null)
    this.#isolation = null
    this.#blockToken = null
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

    this.#state = 'loaded'
    this.#nextIndex = 0

    this.#stats = {
      dispatched: 0,
      injected: 0,
      failed: 0,
      lastError: null,
    }
  }

  start({ speed = 1, routing, isolation } = {}) {
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

    this.#routing = normalizeRouting(routing)
    this.#isolation = isPlainObject(isolation) ? { ...isolation } : null

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
    this.#nextIndex = 0

    this.#baseRealMs = 0
    this.#baseLogicalMs = 0
  }

  getSnapshot() {
    const total = this.#events.length
    const idx = this.#nextIndex

    const positionMs = this.#state === 'playing'
      ? this.#logicalNowMs()
      : this.#baseLogicalMs

    const totalMs = total > 0 ? this.#events[total - 1].tMs : 0

    return {
      state: this.#state,
      speed: this.#speed,
      totalEvents: total,
      nextIndex: idx,
      positionMs,
      totalMs,
      dispatched: this.#stats.dispatched,
      injected: this.#stats.injected,
      failed: this.#stats.failed,
      lastError: this.#stats.lastError,
      routing: {
        defaultSink: this.#routing.defaultSink,
        sinksByStream: Object.fromEntries(this.#routing.sinksByStream.entries()),
      },
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

  #scheduleNext() {
    if (this.#state !== 'playing') return

    while (this.#nextIndex < this.#events.length) {
      const logicalNow = this.#logicalNowMs()
      const next = this.#events[this.#nextIndex]
      const dt = next.tMs - logicalNow

      if (dt <= 0) {
        this.#dispatch(next)
        this.#nextIndex += 1
        continue
      }

      const delayReal = Math.ceil(dt / this.#speed)

      this.#timer = this.#setTimeout(() => {
        this.#timer = null
        this.#scheduleNext()
      }, Math.max(0, delayReal))

      return
    }

    this.#state = 'loaded'
  }

  #dispatch(ev) {
    this.#stats.dispatched += 1

    const stream = String(ev?.stream || '').trim()
    const raw = ev?.raw

    const sink = resolveSink({ stream, routing: this.#routing })

    if (sink === 'device') {
      return this.#dispatchToDevice({ raw, stream })
    }

    if (sink === 'bus') {
      this.#stats.failed += 1
      this.#stats.lastError = 'BUS_SINK_NOT_IMPLEMENTED'

      this.#logger?.warning?.('player_bus_sink_not_implemented', { stream })
      return
    }

    this.#stats.failed += 1
    this.#stats.lastError = 'UNKNOWN_SINK'

    this.#logger?.warning?.('player_unknown_sink', { stream, sink })
  }

  #dispatchToDevice({ raw, stream }) {
    const payload = raw?.payload
    const deviceId = String(payload?.deviceId || '').trim()

    if (!deviceId) {
      this.#stats.failed += 1
      this.#stats.lastError = 'MISSING_DEVICE_ID'

      this.#logger?.warning?.('player_missing_device_id', { stream })
      return
    }

    try {
      const out = this.#deviceManager.inject(deviceId, payload)
      if (!out?.ok) {
        this.#stats.failed += 1
        this.#stats.lastError = out?.error || 'INJECT_FAILED'

        this.#logger?.warning?.('player_inject_failed', {
          deviceId,
          stream,
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
        stream,
        error: e?.message || String(e),
      })
    }
  }

  #maybeBlockDevices() {
    if (!this.#isolation) return
    if (!this.#deviceManager?.blockDevices) return

    const owner = String(this.#isolation.owner || '').trim() || 'recordingPlayer'
    const reason = String(this.#isolation.reason || '').trim() || 'playback'

    const deviceIds = new Set()

    for (const ev of this.#events) {
      const stream = String(ev?.stream || '').trim()
      const sink = resolveSink({ stream, routing: this.#routing })
      if (sink !== 'device') continue

      const deviceId = String(ev?.raw?.payload?.deviceId || '').trim()
      if (deviceId) deviceIds.add(deviceId)
    }

    const ids = [...deviceIds]
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
