// src/cli/recording/cliRecording.js
import fs from 'node:fs'
import formatError from '../../core/errorFormat.js'

const filterPrefix = (options, prefix) => {
  const p = String(prefix || '')
  return options.filter((o) => o.startsWith(p))
}

const safeDirsFromService = (getContext) => {
  try {
    const ctx = getContext()
    const svc = ctx?.recordingService
    const snap = svc?.getSnapshot ? svc.getSnapshot() : null

    const recordingsDir = String(snap?.recordingsDir || '').trim() || null
    const profilesDir = String(snap?.profilesDir || '').trim() || null

    return { recordingsDir, profilesDir }
  } catch {
    return { recordingsDir: null, profilesDir: null }
  }
}

const safeVariantsFromService = (getContext) => {
  try {
    const ctx = getContext()
    const svc = ctx?.recordingService
    const snap = svc?.getSnapshot ? svc.getSnapshot() : null
    const v = snap?.profile?.variants || null

    const record = Array.isArray(v?.record) ? v.record.map(String) : []
    const play = Array.isArray(v?.play) ? v.play.map(String) : []

    return {
      record: record.filter((x) => x && x.trim()).sort(),
      play: play.filter((x) => x && x.trim()).sort(),
    }
  } catch {
    return { record: [], play: [] }
  }
}

const listJson5 = (dirAbs, prefix) => {
  if (!dirAbs) return []

  try {
    const files = fs.readdirSync(dirAbs).filter((f) => f.endsWith('.json5'))
    return filterPrefix(files, prefix)
  } catch {
    return []
  }
}

/*
  Completer node types:
  - { options: string[] }
  - { dynamic: (getContext, prefix) => string[] }
  - { children: { [token]: node }, options?: string[] }
  - { sequence: [node, node, ...] }
*/
const optionsNode = (options) => ({ options: options || [] })
const dynamicNode = (fn) => ({ dynamic: fn })
const sequenceNode = (nodes) => ({ sequence: nodes || [] })
const childrenNode = (children, options) => {
  const c = children || {}
  const computedOptions = Array.isArray(options) && options.length ? options : Object.keys(c)
  return { children: c, options: computedOptions }
}

export const recordingCompleterNode = () => {
  return childrenNode({
    status: optionsNode([]),

    // recording load <profile.json5>
    load: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const { profilesDir } = safeDirsFromService(getContext)
        return listJson5(profilesDir, prefix)
      }),
    ]),

    // recording record [variantKey] | stop
    record: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const variants = safeVariantsFromService(getContext).record
        const opts = ['stop', ...variants]
        return filterPrefix(opts, prefix)
      }),
    ]),

    // recording play [variantKey] [fileName] | <fileName> | pause | stop | resume [speed] | last
    play: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const variants = safeVariantsFromService(getContext).play

        const opts = filterPrefix(['pause', 'stop', 'resume', 'last'], prefix)
        const varOpts = filterPrefix(variants, prefix)

        const { recordingsDir } = safeDirsFromService(getContext)
        const files = listJson5(recordingsDir, prefix)

        // allow 1st token to be either: control word | variantKey | fileName
        return opts.concat(varOpts).concat(files)
      }),
      dynamicNode((getContext, prefix) => {
        const { recordingsDir } = safeDirsFromService(getContext)
        return listJson5(recordingsDir, prefix)
      }),
    ]),
  }, ['status', 'load', 'record', 'play'])
}

export const parseRecording = (parts) => {
  const [a, b, c, d, ...rest] = parts
  if (a !== 'recording') return null

  if (b === 'status') {
    return { kind: 'recording', op: 'status', params: {} }
  }

  if (b === 'load') {
    const profileFile = String(c || '').trim()
    if (!profileFile) {
      return { kind: 'error', message: 'usage: recording load <profile.json5>' }
    }

    return { kind: 'recording', op: 'profile.load', params: { profileFile } }
  }

  if (b === 'record') {
    if (c === 'stop') {
      return { kind: 'recording', op: 'record.stop', params: {} }
    }

    const variantKey = String(c || '').trim() || null
    return { kind: 'recording', op: 'record.record', params: variantKey ? { variantKey } : {} }
  }

  if (b === 'play') {
    if (c === 'pause') return { kind: 'recording', op: 'play.pause', params: {} }
    if (c === 'stop') return { kind: 'recording', op: 'play.stop', params: {} }

    if (c === 'resume') {
      const speedStr = String(d || '').trim()
      if (!speedStr) return { kind: 'recording', op: 'play.resume', params: {} }

      const speed = Number(speedStr)
      if (Number.isNaN(speed) || speed <= 0) {
        return { kind: 'error', message: 'usage: recording play resume [speed] (speed must be > 0)' }
      }

      return { kind: 'recording', op: 'play.resume', params: { speed } }
    }

    if (c === 'last') {
      const variantKey = String(d || '').trim() || null
      return { kind: 'recording', op: 'play.last', params: variantKey ? { variantKey } : {} }
    }

    const t1 = String(c || '').trim()
    if (!t1) {
      return { kind: 'error', message: 'usage: recording play [variantKey] [fileName] | <fileName> | pause | stop | resume [speed] | last' }
    }

    const t2 = String(d || '').trim()

    if (!t2) {
      return { kind: 'recording', op: 'play.play', params: { fileName: t1 } }
    }

    return { kind: 'recording', op: 'play.play', params: { variantKey: t1, fileName: t2 } }
  }

  return { kind: 'error', message: 'usage: recording status|load|record|play' }
}

export const printRecordingHelp = () => {
  console.log('  recording status')
  console.log('  recording load <profile.json5>')
  console.log('  recording record [variantKey]')
  console.log('  recording record stop')
  console.log('  recording play <fileName>')
  console.log('  recording play [variantKey] <fileName>')
  console.log('  recording play last [variantKey]')
  console.log('  recording play pause')
  console.log('  recording play stop')
  console.log('  recording play resume [speed]')
}

export const handleRecording = async ({ ctx, logger }, cmd) => {
  const svc = ctx?.recordingService
  if (!svc?.handleCli) {
    console.log('recording is not supported')
    return
  }

  try {
    const res = await svc.handleCli(cmd)

    if (!res?.ok) {
      const fe = res?.detail || null
      const msg = fe?.message || res?.error || 'recording_error'

      console.log(msg)

      const controlled = Boolean(res?.error) && String(res.error) !== 'ERROR'
      if (!controlled && fe?.stack) {
        console.log(fe.stack)
      }

      return
    }

    if (res?.data !== undefined) {
      logger?.info?.('recording', res.data)
      return
    }

    logger?.info?.('recording', { ok: true })
  } catch (e) {
    const fe = formatError(e)
    const controlled = Boolean(e?.code) && String(e.code) !== 'ERROR'

    console.log(fe?.message || 'recording_error')

    if (!controlled && fe?.stack) {
      console.log(fe.stack)
    }
  }
}

export default {
  recordingCompleterNode,
  parseRecording,
  printRecordingHelp,
  handleRecording,
}
