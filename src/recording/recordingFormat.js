// src/recording/recordingFormat.js
import path from 'node:path'

export const RECORDING_FORMAT = 'charlie.recording'
export const RECORDING_VERSION = '1.0.0'

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const fail = (error, message) => ({ ok: false, error, message })

const isSemverString = (v) => {
  const s = String(v || '')
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(s)
}

export const validateRecording = function validateRecording(recording) {
  if (!isPlainObject(recording)) return fail('INVALID_RECORDING', 'recording must be an object')

  if (recording.format !== RECORDING_FORMAT) return fail('INVALID_FORMAT', 'unexpected recording.format')
  if (!isSemverString(recording.version) || recording.version !== RECORDING_VERSION) {
    return fail('INVALID_VERSION', 'unexpected recording.version')
  }

  if (!isPlainObject(recording.meta)) return fail('INVALID_META', 'recording.meta missing')

  const mode = String(recording.meta.mode || '').trim()
  if (!mode) return fail('INVALID_META_MODE', 'recording.meta.mode missing')

  const buses = Array.isArray(recording.meta.buses) ? recording.meta.buses : null
  if (!buses || !buses.length) return fail('INVALID_META_BUSES', 'recording.meta.buses missing')

  for (const b of buses) {
    const s = String(b || '').trim()
    if (!s) return fail('INVALID_META_BUSES', 'recording.meta.buses contains empty bus name')
  }

  if (!isPlainObject(recording.timeline)) return fail('INVALID_TIMELINE', 'recording.timeline missing')
  const unit = String(recording.timeline.unit || '').trim()
  if (unit !== 'ms') return fail('INVALID_TIMELINE_UNIT', 'recording.timeline.unit must be "ms"')

  if (!isPlainObject(recording.streamsObserved)) return fail('INVALID_STREAMS_OBSERVED', 'recording.streamsObserved missing')

  const events = Array.isArray(recording.events) ? recording.events : null
  if (!events) return fail('INVALID_EVENTS', 'recording.events missing')

  let lastT = -1
  let lastI = -1

  for (let idx = 0; idx < events.length; idx += 1) {
    const ev = events[idx]
    if (!isPlainObject(ev)) return fail('INVALID_EVENT', `event must be object at index ${idx}`)

    const id = String(ev.id || '').trim()
    if (!id) return fail('INVALID_EVENT_ID', `event.id missing at index ${idx}`)

    const i = ev.i
    if (typeof i !== 'number' || Number.isNaN(i) || i < 0) {
      return fail('INVALID_EVENT_I', `invalid event.i at index ${idx}`)
    }

    if (i <= lastI) return fail('NON_MONOTONIC_I', `events must be strictly increasing by i (index ${idx})`)
    lastI = i

    const tMs = ev.tMs
    if (typeof tMs !== 'number' || Number.isNaN(tMs) || tMs < 0) {
      return fail('INVALID_TMS', `invalid tMs at index ${idx}`)
    }

    if (tMs < lastT) return fail('NON_MONOTONIC_TMS', `events must be monotonic by tMs (index ${idx})`)
    lastT = tMs

    const raw = ev.raw
    if (!isPlainObject(raw)) return fail('INVALID_RAW', `event.raw missing at index ${idx}`)

    const streamKey = String(raw.streamKey || '').trim()
    if (!streamKey) return fail('INVALID_STREAMKEY', `event.raw.streamKey missing at index ${idx}`)

    if (!recording.streamsObserved[streamKey]) {
      return fail('STREAMKEY_NOT_OBSERVED', `streamsObserved missing streamKey used by event at index ${idx}`)
    }
  }

  return { ok: true }
}

export const normalizeRecordingPath = function normalizeRecordingPath({ baseDir, nameOrPath }) {
  const base = path.resolve(String(baseDir || '.'))
  const raw = String(nameOrPath || '').trim()

  if (!raw) {
    const err = new Error('missing_path')
    err.code = 'BAD_REQUEST'
    throw err
  }

  const candidate = path.resolve(base, raw)
  const rel = path.relative(base, candidate)

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('path_outside_baseDir')
    err.code = 'BAD_REQUEST'
    throw err
  }

  return candidate
}

export default {
  RECORDING_FORMAT,
  RECORDING_VERSION,
  validateRecording,
  normalizeRecordingPath,
}
