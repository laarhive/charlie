// src/recording/recorder.js
import { RECORDING_FORMAT, RECORDING_VERSION } from './recordingFormat.js'
import { shortId } from '../utils/shortId.js'

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const parseStreamKey3 = (streamKey) => {
  const s = String(streamKey || '').trim()
  if (!s) return null

  const parts = s.split('::')
  if (parts.length < 3) return null

  const who = String(parts[0] || '').trim()
  const what = String(parts[1] || '').trim()
  const where = (parts.length >= 4)
    ? String(parts[2] || '').trim()
    : String(parts[2] || '').trim()

  if (!who || !what || !where) return null
  return { who, what, where }
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

  // '*' matches any (including empty, but our values are validated non-empty upstream)
  // '?' matches exactly one char
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
  const sk = parseStreamKey3(streamKey)
  if (!p || !sk) return false

  if (!matchSegment(p.who, sk.who)) return false
  if (!matchSegment(p.what, sk.what)) return false
  if (!matchSegment(p.where, sk.where)) return false

  return true
}

const normalizeSelect = (select) => {
  const s = isPlainObject(select) ? select : {}

  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [])

  const includeStreamKeys = arr(s.includeStreamKeys)
  const excludeStreamKeys = arr(s.excludeStreamKeys)

  return {
    includeStreamKeys: includeStreamKeys.length ? includeStreamKeys : null,
    excludeStreamKeys: excludeStreamKeys.length ? excludeStreamKeys : null,
  }
}

const passesSelect = ({ raw, select }) => {
  if (!select) return true

  const streamKey = String(raw?.streamKey || '').trim()
  if (!streamKey) return false

  if (select.includeStreamKeys) {
    let ok = false
    for (const p of select.includeStreamKeys) {
      if (matchStreamKey3({ pattern: p, streamKey })) {
        ok = true
        break
      }
    }

    if (!ok) return false
  }

  if (select.excludeStreamKeys) {
    for (const p of select.excludeStreamKeys) {
      if (matchStreamKey3({ pattern: p, streamKey })) {
        return false
      }
    }
  }

  return true
}

const deriveKindHint = (raw) => {
  const p = isPlainObject(raw?.payload) ? raw.payload : null
  const publishAs = String(p?.publishAs || '').trim()
  if (publishAs) return 'device'

  const source = String(raw?.source || '').trim().toLowerCase()
  if (source.includes('controller')) return 'controller'
  if (source.includes('manager')) return 'system'

  return 'unknown'
}

export class Recorder {
  #logger
  #buses
  #busNames
  #nowMs

  #started
  #stopped
  #unsubs

  #t0Ms
  #lastTMs
  #warnedNonMonotonic

  #events
  #meta
  #select

  #sessionId
  #eventSeq

  #streamsObserved

  constructor({ logger, buses, busNames, nowMs, meta, select }) {
    this.#logger = logger
    this.#buses = buses || {}

    this.#busNames = Array.isArray(busNames)
      ? busNames.map((x) => String(x || '').trim()).filter(Boolean)
      : []

    this.#nowMs = typeof nowMs === 'function' ? nowMs : () => Date.now()

    this.#started = false
    this.#stopped = false
    this.#unsubs = []

    this.#t0Ms = 0
    this.#lastTMs = -1
    this.#warnedNonMonotonic = false

    this.#events = []

    this.#meta = isPlainObject(meta) ? { ...meta } : {}
    this.#select = normalizeSelect(select)

    this.#sessionId = shortId()
    this.#eventSeq = 0

    this.#streamsObserved = {}
  }

  start() {
    if (this.#started) return

    this.#started = true
    this.#stopped = false

    this.#t0Ms = this.#nowMs()
    this.#lastTMs = -1
    this.#warnedNonMonotonic = false

    this.#sessionId = shortId()
    this.#eventSeq = 0

    this.#events = []
    this.#streamsObserved = {}

    for (const busName of this.#busNames) {
      const b = this.#buses?.[busName]
      if (!b || typeof b.subscribe !== 'function') {
        this.#logger?.warning?.('recorder_bus_missing', { bus: busName })
        continue
      }

      const unsub = b.subscribe((evt) => {
        this.#onEvent({ evt })
      })

      this.#unsubs.push(unsub)
    }

    this.#logger?.notice?.('recorder_started', { buses: this.#busNames })
  }

  stop() {
    if (!this.#started || this.#stopped) {
      return this.#buildRecording()
    }

    this.#stopped = true

    for (const unsub of this.#unsubs) {
      try {
        unsub()
      } catch {
        // ignore
      }
    }

    this.#unsubs = []
    this.#logger?.notice?.('recorder_stopped', {})

    return this.#buildRecording()
  }

  getSnapshot() {
    return {
      started: this.#started,
      stopped: this.#stopped,
      busNames: [...this.#busNames],
      events: this.#events.length,
      lastTMs: this.#lastTMs,
      sessionId: this.#sessionId,
      meta: { ...this.#meta },
    }
  }

  #observeStream({ streamKey, raw }) {
    const sk = parseStreamKey3(streamKey)
    if (!sk) return

    const bus = sk.where
    const kind = deriveKindHint(raw)

    if (!this.#streamsObserved[streamKey]) {
      this.#streamsObserved[streamKey] = { kind, bus }
      return
    }

    const existing = this.#streamsObserved[streamKey]
    if (!existing.bus) existing.bus = bus
  }

  #onEvent({ evt }) {
    if (this.#stopped) return
    if (!isPlainObject(evt)) return

    const raw = evt

    const streamKey = String(raw?.streamKey || '').trim()
    if (!streamKey) return

    if (!passesSelect({ raw, select: this.#select })) return

    const now = this.#nowMs()
    let tMs = now - this.#t0Ms
    if (tMs < 0) tMs = 0

    if (tMs < this.#lastTMs) {
      tMs = this.#lastTMs

      if (!this.#warnedNonMonotonic) {
        this.#warnedNonMonotonic = true
        this.#logger?.warning?.('recorder_non_monotonic_time', {})
      }
    }

    this.#lastTMs = tMs

    try {
      JSON.stringify(raw)
    } catch {
      this.#logger?.warning?.('recorder_drop_non_serializable', { streamKey })
      return
    }

    this.#observeStream({ streamKey, raw })

    const i = this.#eventSeq
    const id = `${this.#sessionId}-${i}`
    this.#eventSeq += 1

    this.#events.push({ id, i, tMs, raw })
  }

  #buildRecording() {
    const recordedAtMs = this.#nowMs()
    const buses = Array.isArray(this.#busNames) ? [...this.#busNames] : []

    return {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,

      meta: {
        recordedAtMs,
        buses,
        ...this.#meta,
      },

      timeline: { unit: 'ms' },

      streamsObserved: { ...this.#streamsObserved },

      events: this.#events.slice(0),
    }
  }
}

export default Recorder
