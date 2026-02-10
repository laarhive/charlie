// src/recording/recordingService.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import JSON5 from 'json5'

import Recorder from './recorder.js'
import Player from './player.js'
import RecordingStore from './recordingStore.js'
import formatError from '../core/errorFormat.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

const normalizeConfigRelPath = function normalizeConfigRelPath(p) {
  const raw = String(p || '').trim()
  if (!raw) return null

  if (raw.startsWith('\\\\')) return raw
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw

  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return raw.replace(/^[\\/]+/, '')
  }

  return raw
}

const resolveFromProjectRoot = function resolveFromProjectRoot(p) {
  const v = normalizeConfigRelPath(p)
  if (!v) return null

  if (path.isAbsolute(v)) return v
  return path.resolve(projectRoot, v)
}

const parseDurationMs = function parseDurationMs(v) {
  if (v === undefined || v === null) return null

  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }

  const s = String(v).trim().toLowerCase()
  if (!s) return null

  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(s)
  if (!m) return null

  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null

  const unit = m[2] || 'ms'
  if (unit === 'ms') return Math.round(n)
  if (unit === 's') return Math.round(n * 1000)
  if (unit === 'm') return Math.round(n * 60_000)

  return null
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const isControlledError = (e) => {
  const c = String(e?.code || '').trim()
  return Boolean(c) && c !== 'ERROR'
}

const stripStacksDeep = (fe) => {
  if (!isPlainObject(fe)) return fe

  const out = { ...fe }
  if (out.stack) delete out.stack

  if (out.cause && isPlainObject(out.cause)) {
    out.cause = stripStacksDeep(out.cause)
  }

  return out
}

const mergeDeep = (base, override) => {
  if (!isPlainObject(base)) return isPlainObject(override) ? { ...override } : override
  if (!isPlainObject(override)) return override

  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    const bv = out[k]

    if (isPlainObject(bv) && isPlainObject(v)) {
      out[k] = mergeDeep(bv, v)
      continue
    }

    out[k] = v
  }

  return out
}

const resolveVariantParams = ({ root, variantKey, what }) => {
  const r = isPlainObject(root) ? root : null
  if (!r) {
    const err = new Error(`${what}_missing`)
    err.code = 'BAD_REQUEST'
    throw err
  }

  const params = isPlainObject(r.params) ? r.params : {}

  if (variantKey === undefined || variantKey === null || String(variantKey).trim() === '') {
    return { ...params }
  }

  const k = String(variantKey).trim()
  const variant = r[k]

  if (!isPlainObject(variant)) {
    const err = new Error(`${what}_unknown_variant`)
    err.code = 'BAD_REQUEST'
    err.detail = { variantKey: k }
    throw err
  }

  return mergeDeep(params, variant)
}

const listVariantKeys = (root) => {
  if (!isPlainObject(root)) return []

  const reserved = new Set(['op', 'params'])
  return Object.keys(root)
    .filter((k) => !reserved.has(k) && isPlainObject(root[k]))
    .sort()
}

export const RecordingService = function RecordingService({ logger, buses, deviceManager, clock, config, mode }) {
  const recordingsDirCfg = String(config?.recording?.recordingsDir || './recordings')
  const recordingsDirAbs = resolveFromProjectRoot(recordingsDirCfg) || path.resolve(projectRoot, 'recordings')

  const profilesDirAbs = path.resolve(recordingsDirAbs, 'profiles')
  const store = new RecordingStore({ baseDir: recordingsDirAbs, logger })

  const serviceMode = String(
    mode ??
    config?.mode ??
    config?.runtime?.mode ??
    ''
  ).trim()

  if (!serviceMode) {
    const err = new Error('missing_service_mode')
    err.code = 'BAD_REQUEST'
    throw err
  }

  let recorderSession = null
  let playerSession = null

  let profileSession = null

  const normalizeBusNames = function normalizeBusNames(busNames) {
    const raw = Array.isArray(busNames) ? busNames : []

    const out = raw
      .map((x) => String(x || '').trim())
      .filter((x) => x && buses?.[x]?.subscribe)

    if (!out.length) {
      const err = new Error('missing_busNames')
      err.code = 'BAD_REQUEST'
      throw err
    }

    return Array.from(new Set(out))
  }

  const nowLocalStamp = function nowLocalStamp() {
    const d = new Date()

    const yy = String(d.getFullYear() % 100).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')

    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')

    return `${yy}${mm}${dd}-${hh}${mi}${ss}`
  }

  const sanitizeFileToken = function sanitizeFileToken(s, { maxLen = 48 } = {}) {
    const raw = String(s || '').trim()
    if (!raw) return ''

    const replaced = raw.replace(/\s+/g, '-')
    const cleaned = replaced.replace(/[^A-Za-z0-9\-#\.,_\[\]\{\}\(\)]/g, '')
    const collapsed = cleaned.replace(/-+/g, '-')

    return collapsed.slice(0, maxLen)
  }

  const ensureJson5Name = function ensureJson5Name(name, { what }) {
    const s = String(name || '').trim()
    if (!s) {
      const err = new Error(`missing_${what}`)
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (!s.toLowerCase().endsWith('.json5')) {
      const err = new Error(`${what}_must_end_with_json5`)
      err.code = 'BAD_REQUEST'
      throw err
    }

    return s
  }

  const resolveInsideDir = function resolveInsideDir(baseDir, nameOrRelPath, { what }) {
    const name = ensureJson5Name(nameOrRelPath, { what })

    const rel = (name.startsWith('/') || name.startsWith('\\'))
      ? name.replace(/^[\\/]+/, '')
      : name

    const full = path.resolve(baseDir, rel)

    const relFromBase = path.relative(baseDir, full)
    if (relFromBase.startsWith('..') || path.isAbsolute(relFromBase)) {
      const err = new Error(`${what}_outside_baseDir`)
      err.code = 'BAD_REQUEST'
      throw err
    }

    return full
  }

  const loadProfileFile = async function loadProfileFile(profileFile) {
    const fullPath = resolveInsideDir(profilesDirAbs, profileFile, { what: 'profileFile' })

    let txt
    try {
      txt = await fs.readFile(fullPath, 'utf8')
    } catch (e) {
      const err = new Error(`profileFile_read_failed:${path.basename(fullPath)}`)
      err.code = 'BAD_REQUEST'
      err.cause = e
      throw err
    }

    let parsed
    try {
      parsed = JSON5.parse(txt)
    } catch (e) {
      const err = new Error('profileFile_invalid_json5')
      err.code = 'BAD_REQUEST'
      err.cause = e
      throw err
    }

    if (!isPlainObject(parsed)) {
      const err = new Error('profileFile_invalid_root')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const profileName = String(parsed.profile || '').trim()
    if (!profileName) {
      const err = new Error('profile_missing_profile_name')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const record = isPlainObject(parsed.record) ? parsed.record : null
    const play = isPlainObject(parsed.play) ? parsed.play : null

    if (!record || !play) {
      const err = new Error('profile_missing_record_or_play')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const recordOp = String(record.op || '').trim()
    const playOp = String(play.op || '').trim()

    if (recordOp !== 'record.start') {
      const err = new Error('profile_record_op_must_be_record_start')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (playOp !== 'play.start') {
      const err = new Error('profile_play_op_must_be_play_start')
      err.code = 'BAD_REQUEST'
      throw err
    }

    return {
      path: fullPath,
      profileName,
      recordRoot: record,
      playRoot: play,
    }
  }

  const requirePlayer = function requirePlayer() {
    if (!playerSession?.player) {
      const err = new Error('player_not_loaded')
      err.code = 'BAD_REQUEST'
      throw err
    }

    return playerSession.player
  }

  const requireProfile = function requireProfile() {
    if (!profileSession) {
      const err = new Error('profile_not_loaded')
      err.code = 'BAD_REQUEST'
      throw err
    }

    return profileSession
  }

  const getSnapshot = function getSnapshot() {
    const recSnap = recorderSession?.recorder?.getSnapshot ? recorderSession.recorder.getSnapshot() : null
    const playSnap = playerSession?.player?.getSnapshot ? playerSession.player.getSnapshot() : null

    const recordVariants = profileSession?.recordRoot ? listVariantKeys(profileSession.recordRoot) : []
    const playVariants = profileSession?.playRoot ? listVariantKeys(profileSession.playRoot) : []

    return {
      recordingsDir: store.getBaseDir(),
      profilesDir: profilesDirAbs,

      profile: profileSession ? {
        loadedPath: profileSession.path,
        profile: profileSession.profileName,
        variants: {
          record: recordVariants,
          play: playVariants,
        },
      } : null,

      record: recorderSession ? {
        state: recorderSession.state,
        startedAtMs: recorderSession.startedAtMs,
        durationMs: recorderSession.durationMs,
        autoStopAtMs: recorderSession.autoStopAtMs,
        outBase: recorderSession.outBase,
        comment: recorderSession.comment,
        lastSavedPath: recorderSession.lastSavedPath,
        details: recSnap,
      } : { state: 'idle' },

      play: playerSession ? {
        loadedPath: playerSession.loadedPath,
        ...playSnap,
      } : { state: 'idle' },
    }
  }

  const getStatusSnapshot = function getStatusSnapshot() {
    const snap = getSnapshot()

    const recordState = String(snap?.record?.state || 'idle')
    const playState = String(snap?.play?.state || 'idle')

    const out = {}

    if (recordState !== 'idle') out.record = snap.record
    if (playState !== 'idle') out.play = snap.play

    if (!out.record && !out.play) {
      return { state: 'idle' }
    }

    return out
  }

  const recordStart = function recordStart({ busNames, duration, durationMs, fileNameBase, meta, comment, select } = {}) {
    if (recorderSession?.state === 'recording') {
      const err = new Error('recording_already_running')
      err.code = 'CONFLICT'
      throw err
    }

    const busesToUse = normalizeBusNames(busNames)

    const dur = parseDurationMs(duration !== undefined ? duration : durationMs)
    if (dur !== null && (Number.isNaN(dur) || dur <= 0)) {
      const err = new Error('invalid_duration')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (dur !== null && dur > 24 * 60 * 60 * 1000) {
      const err = new Error('duration_too_large')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const sessionMeta = meta && typeof meta === 'object' ? { ...meta } : {}
    delete sessionMeta.mode

    const commentStr = String(comment || '').trim() || null
    const commentSuffix = commentStr ? sanitizeFileToken(commentStr, { maxLen: 48 }) : ''

    const baseRaw = String(fileNameBase || '').trim() || 'recording'
    const outBase = sanitizeFileToken(baseRaw, { maxLen: 64 }) || 'recording'

    const recorder = new Recorder({
      logger,
      buses,
      busNames: busesToUse,
      clock,
      select,
      meta: {
        mode: serviceMode,
        recordedAtClockMs: clock?.nowMs ? clock.nowMs() : Date.now(),
        comment: commentStr || undefined,
        commentSuffix: commentSuffix || undefined,
        ...sessionMeta,
      },
    })

    recorder.start()

    const startedAtMs = Date.now()
    const autoStopAtMs = dur ? startedAtMs + dur : null

    recorderSession = {
      state: 'recording',
      recorder,
      startedAtMs,
      durationMs: dur,
      autoStopAtMs,

      outBase,
      comment: commentStr,
      commentSuffix,

      timer: null,
      lastSavedPath: null,
    }

    if (dur) {
      recorderSession.timer = setTimeout(() => {
        void recordStop({ reason: 'duration' })
      }, dur)
    }

    const snap = getSnapshot()

    logger?.notice?.('recording_started', {
      buses: busesToUse,
      durationMs: dur,
      fileNameBase: outBase,
      comment: commentStr,
    })

    logger?.notice?.('recording_started_snapshot', {
      record: snap.record,
      play: snap.play,
      profile: snap.profile,
    })

    return snap
  }

  const recordStop = async function recordStop({ reason } = {}) {
    if (!recorderSession || recorderSession.state !== 'recording') {
      const err = new Error('recording_not_running')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (recorderSession.timer) {
      clearTimeout(recorderSession.timer)
      recorderSession.timer = null
    }

    const recording = recorderSession.recorder.stop()
    recorderSession.state = 'stopped'

    const stamp = nowLocalStamp()
    const suffix = recorderSession.commentSuffix ? `-${recorderSession.commentSuffix}` : ''

    const counter = await store.nextRecordingCounter()
    const filename = `${counter}-${recorderSession.outBase}-${stamp}${suffix}.json5`

    const saved = await store.save({ filename, recording })
    recorderSession.lastSavedPath = saved.path

    const snap = getSnapshot()

    logger?.notice?.('recording_stopped', {
      reason: reason || 'manual',
      path: recorderSession.lastSavedPath,
      filename,
    })

    logger?.notice?.('recording_stopped_snapshot', {
      record: snap.record,
      play: snap.play,
      profile: snap.profile,
    })

    return {
      savedPath: recorderSession.lastSavedPath,
      snapshot: snap,
    }
  }

  const playLoad = async function playLoad({ path: p } = {}) {
    const file = String(p || '').trim()
    if (!file) {
      const err = new Error('missing_path')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const loaded = await store.load({ nameOrPath: file })

    if (!playerSession) {
      playerSession = {
        player: new Player({
          logger,
          deviceManager,
          buses,
          clock,
        }),
        loadedPath: null,
      }
    } else {
      playerSession.player.stop()
    }

    playerSession.loadedPath = loaded.path
    playerSession.player.load(loaded.recording)

    logger?.notice?.('play_loaded', { path: loaded.path })
    return getSnapshot()
  }

  const playStart = function playStart({ speed, routingByStreamKey, rewriteTs, isolation, interval } = {}) {
    const player = requirePlayer()

    player.start({
      speed: speed === undefined ? 1 : speed,
      routingByStreamKey,
      rewriteTs: rewriteTs === true,
      isolation,
      interval,
      onEnd: ({ reason, snapshot }) => {
        const snap = getSnapshot()

        logger?.notice?.('play_ended', {
          reason,
          playerSnapshot: snapshot,
          loadedPath: playerSession?.loadedPath || null,
        })

        logger?.notice?.('play_ended_snapshot', {
          play: snap.play,
          record: snap.record,
          profile: snap.profile,
        })
      },
    })

    const snap = getSnapshot()

    logger?.notice?.('play_started', { speed: player.getSnapshot().speed })
    logger?.notice?.('play_started_snapshot', {
      play: snap.play,
      record: snap.record,
      profile: snap.profile,
    })

    return snap
  }

  const playPause = function playPause() {
    const player = requirePlayer()
    player.pause()
    return getSnapshot()
  }

  const playResume = function playResume({ speed } = {}) {
    const player = requirePlayer()
    player.resume({ speed })
    return getSnapshot()
  }

  const playStop = function playStop() {
    const player = requirePlayer()
    player.stop()

    const snap = getSnapshot()

    logger?.notice?.('play_stopped_snapshot', {
      play: snap.play,
      record: snap.record,
      profile: snap.profile,
    })

    return snap
  }

  const profileLoad = async function profileLoad({ profileFile } = {}) {
    const file = String(profileFile || '').trim()
    if (!file) {
      const err = new Error('missing_profileFile')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const loaded = await loadProfileFile(file)

    profileSession = {
      path: loaded.path,
      profileName: loaded.profileName,
      recordRoot: loaded.recordRoot,
      playRoot: loaded.playRoot,
    }

    logger?.notice?.('profile_loaded', { profile: loaded.profileName, path: loaded.path })
    return getSnapshot()
  }

  const recordRecord = function recordRecord({ variantKey } = {}) {
    const prof = requireProfile()

    if (recorderSession?.state === 'recording') {
      logger?.notice?.('recording_record_ignored_already_running', {
        profile: prof.profileName,
      })
      return getSnapshot()
    }

    const p0 = resolveVariantParams({ root: prof.recordRoot, variantKey, what: 'profile_record' })

    const fileNameBaseRaw = String(
      p0.fileNameBase ?? prof.profileName ?? ''
    ).trim()

    const fileNameBase = sanitizeFileToken(fileNameBaseRaw, { maxLen: 64 }) || 'recording'

    const meta0 = isPlainObject(p0.meta) ? { ...p0.meta } : {}
    meta0.profileFile = path.basename(prof.path)
    meta0.profile = prof.profileName
    meta0.appliedRecordParams = { ...p0, fileNameBase, meta: undefined }
    meta0.appliedRecordParams.meta = isPlainObject(p0.meta) ? { ...p0.meta } : {}

    return recordStart({
      ...p0,
      fileNameBase,
      meta: meta0,
    })
  }

  const playLast = async function playLast({ variantKey } = {}) {
    const prof = requireProfile()

    const p0 = resolveVariantParams({ root: prof.playRoot, variantKey, what: 'profile_play' })

    const recParams = resolveVariantParams({ root: prof.recordRoot, variantKey: null, what: 'profile_record' })
    const recBaseRaw = String(recParams?.fileNameBase ?? prof.profileName ?? '').trim()
    const outBase = sanitizeFileToken(recBaseRaw, { maxLen: 64 }) || 'recording'

    const last = await store.findLastRecordingByCounter({ outBase })
    if (!last?.ok || !last.path) {
      const err = new Error('no_recordings_found_for_profile')
      err.code = 'BAD_REQUEST'
      throw err
    }

    await playLoad({ path: last.path })
    return playStart({
      speed: p0.speed,
      routingByStreamKey: p0.routingByStreamKey,
      rewriteTs: p0.rewriteTs,
      isolation: p0.isolation,
      interval: p0.interval,
    })
  }

  const playPlay = async function playPlay({ variantKey, fileName } = {}) {
    const prof = requireProfile()

    const p0 = resolveVariantParams({ root: prof.playRoot, variantKey, what: 'profile_play' })

    const overrideFile = String(fileName || '').trim()
    const chosenFile = overrideFile || String(p0.fileName || '').trim()

    if (!chosenFile) {
      const err = new Error('missing_fileName')
      err.code = 'BAD_REQUEST'
      throw err
    }

    await playLoad({ path: chosenFile })
    return playStart({
      speed: p0.speed,
      routingByStreamKey: p0.routingByStreamKey,
      rewriteTs: p0.rewriteTs,
      isolation: p0.isolation,
      interval: p0.interval,
    })
  }

  const doHandle = async function doHandle({ op, params } = {}) {
    const kind = String(op || '').trim()
    const p = params && typeof params === 'object' ? params : {}

    if (kind === 'status') return getStatusSnapshot()

    if (kind === 'profile.load') return await profileLoad(p)

    if (kind === 'record.record') return recordRecord(p)
    if (kind === 'record.start') return recordStart(p)
    if (kind === 'record.stop') return await recordStop(p)

    if (kind === 'play.last') return await playLast(p)
    if (kind === 'play.play') return await playPlay(p)
    if (kind === 'play.load') return await playLoad(p)
    if (kind === 'play.start') return playStart(p)
    if (kind === 'play.pause') return playPause()
    if (kind === 'play.resume') return playResume(p)
    if (kind === 'play.stop') return playStop()

    const err = new Error('unknown_op')
    err.code = 'BAD_REQUEST'
    throw err
  }

  const handle = async function handle({ op, params } = {}) {
    const opName = String(op || '').trim() || 'unknown'
    const snapshotBefore = getSnapshot()

    try {
      const data = await doHandle({ op, params })
      const snapshotAfter = getSnapshot()

      logger?.info?.('recording_op_ok', { op: opName })

      return {
        ok: true,
        data,
        opStatus: {
          op: opName,
          snapshotBefore,
          snapshotAfter,
        },
      }
    } catch (e) {
      const fe0 = formatError(e)
      const controlled = isControlledError(e)
      const fe = controlled ? stripStacksDeep(fe0) : fe0
      const code = String(e?.code || 'ERROR')

      const snapshotAfter = getSnapshot()

      logger?.error?.('recording_op_failed', {
        op: opName,
        error: fe,
      })

      return {
        ok: false,
        error: code,
        detail: fe,
        opStatus: {
          op: opName,
          snapshotBefore,
          snapshotAfter,
        },
      }
    }
  }

  const handleCli = async function handleCli(cmd) {
    const op = String(cmd?.op || '').trim()
    const params = cmd?.params && typeof cmd.params === 'object' ? cmd.params : {}

    if (op === 'profile.load') return await handle({ op, params })

    if (op === 'record.record') return await handle({ op, params })
    if (op === 'play.last') return await handle({ op, params })
    if (op === 'play.play') return await handle({ op, params })

    if (op === 'play.start') {
      const p = params?.path
      const speed = params?.speed
      const routingByStreamKey = params?.routingByStreamKey
      const rewriteTs = params?.rewriteTs
      const isolation = params?.isolation
      const interval = params?.interval

      const loaded = await handle({ op: 'play.load', params: { path: p } })
      if (!loaded?.ok) return loaded

      return await handle({
        op: 'play.start',
        params: { speed, routingByStreamKey, rewriteTs, isolation, interval },
      })
    }

    return await handle({ op, params })
  }

  return {
    getSnapshot,
    handle,
    handleCli,

    sanitizeFileToken,
  }
}

export default RecordingService
