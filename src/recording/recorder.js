// src/recording/recorder.js
import { RECORDING_FORMAT, RECORDING_VERSION } from './recordingFormat.js'

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const deriveStream = (raw) => {
  const p = isPlainObject(raw?.payload) ? raw.payload : null

  const a = String(p?.publishAs || '').trim()
  if (a) return a

  const b = String(p?.deviceId || '').trim()
  if (b) return b

  const c = String(raw?.source || '').trim()
  if (c) return c

  const d = String(raw?.type || '').trim()
  if (d) return d

  return ''
}

const normalizeFilter = (filter) => {
  const f = isPlainObject(filter) ? filter : {}

  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [])

  const includeStreams = arr(f.includeStreams)
  const excludeStreams = arr(f.excludeStreams)
  const includeTypes = arr(f.includeTypes)
  const excludeTypes = arr(f.excludeTypes)

  return {
    includeStreams: includeStreams.length ? new Set(includeStreams) : null,
    excludeStreams: excludeStreams.length ? new Set(excludeStreams) : null,
    includeTypes: includeTypes.length ? new Set(includeTypes) : null,
    excludeTypes: excludeTypes.length ? new Set(excludeTypes) : null,
  }
}

const passesFilter = ({ stream, raw, filter }) => {
  if (!filter) return true

  if (filter.includeStreams && !filter.includeStreams.has(stream)) return false
  if (filter.excludeStreams && filter.excludeStreams.has(stream)) return false

  const t = String(raw?.type || '').trim()

  if (filter.includeTypes && !filter.includeTypes.has(t)) return false
  if (filter.excludeTypes && filter.excludeTypes.has(t)) return false

  return true
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
  #filter

  constructor({ logger, buses, busNames, nowMs, meta, filter }) {
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
    this.#filter = normalizeFilter(filter)
  }

  start() {
    if (this.#started) return

    this.#started = true
    this.#stopped = false

    this.#t0Ms = this.#nowMs()
    this.#lastTMs = -1
    this.#warnedNonMonotonic = false

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

    this.#logger?.notice?.('recorder_started', {
      buses: this.#busNames,
    })
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
      meta: { ...this.#meta },
    }
  }

  #onEvent({ evt }) {
    if (this.#stopped) return
    if (!isPlainObject(evt)) return

    const raw = evt
    const stream = deriveStream(raw)
    if (!stream) return

    if (!passesFilter({ stream, raw, filter: this.#filter })) return

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
      this.#logger?.warning?.('recorder_drop_non_serializable', { stream })
      return
    }

    this.#events.push({ tMs, stream, raw })
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

      events: this.#events.slice(0),
    }
  }
}

export default Recorder
