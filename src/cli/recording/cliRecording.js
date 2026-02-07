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
    const cmdsDir = String(snap?.cmdsDir || '').trim() || null

    return { recordingsDir, cmdsDir }
  } catch {
    return { recordingsDir: null, cmdsDir: null }
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

    // recording start <macro.json5>
    start: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const { cmdsDir } = safeDirsFromService(getContext)
        return listJson5(cmdsDir, prefix)
      }),
    ]),

    // legacy: recording record <macro.json5> / recording record stop
    record: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const opts = filterPrefix(['stop'], prefix)

        const { cmdsDir } = safeDirsFromService(getContext)
        const files = listJson5(cmdsDir, prefix)

        return opts.concat(files)
      }),
    ]),

    // recording load <file.json5>
    load: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const { recordingsDir } = safeDirsFromService(getContext)
        return listJson5(recordingsDir, prefix)
      }),
    ]),

    // recording play <file.json5> [speed] | pause | stop | resume [speed]
    play: sequenceNode([
      dynamicNode((getContext, prefix) => {
        const opts = filterPrefix(['pause', 'stop', 'resume'], prefix)

        const { recordingsDir } = safeDirsFromService(getContext)
        const files = listJson5(recordingsDir, prefix)

        return opts.concat(files)
      }),
      optionsNode(['0.5', '1', '1.5', '2', '3']),
    ]),
  }, ['status', 'start', 'record', 'load', 'play'])
}

export const parseRecording = (parts) => {
  const [a, b, c, ...rest] = parts
  if (a !== 'recording') return null

  if (b === 'status') {
    return { kind: 'recording', op: 'status', params: {} }
  }

  if (b === 'start') {
    // recording start <macro.json5> [comment...]
    const cmdFile = String(c || '').trim()
    if (!cmdFile) {
      return { kind: 'error', message: 'usage: recording start <macro.json5> [comment...]' }
    }

    const comment = rest.join(' ').trim() || null

    return {
      kind: 'recording',
      op: 'record.start',
      params: { cmdFile, comment },
    }
  }

  if (b === 'record') {
    // recording record stop
    if (c === 'stop') {
      return { kind: 'recording', op: 'record.stop', params: {} }
    }

    // recording record <macro.json5> [comment...]
    const cmdFile = String(c || '').trim()
    if (!cmdFile) {
      return { kind: 'error', message: 'usage: recording record <macro.json5> [comment...] | recording record stop' }
    }

    const comment = rest.join(' ').trim() || null

    return {
      kind: 'recording',
      op: 'record.start',
      params: { cmdFile, comment },
    }
  }

  if (b === 'load') {
    const file = String(c || '').trim()
    if (!file) {
      return { kind: 'error', message: 'usage: recording load <recordingFile.json5>' }
    }

    return { kind: 'recording', op: 'play.load', params: { path: file } }
  }

  if (b === 'play') {
    if (c === 'pause') return { kind: 'recording', op: 'play.pause', params: {} }
    if (c === 'stop') return { kind: 'recording', op: 'play.stop', params: {} }

    if (c === 'resume') {
      const speedStr = rest[0]
      if (!speedStr) return { kind: 'recording', op: 'play.resume', params: {} }

      const speed = Number(speedStr)
      if (Number.isNaN(speed) || speed <= 0) {
        return { kind: 'error', message: 'usage: recording play resume [speed] (speed must be > 0)' }
      }

      return { kind: 'recording', op: 'play.resume', params: { speed } }
    }

    const file = String(c || '').trim()
    if (!file) {
      return { kind: 'error', message: 'usage: recording play <recordingFile.json5> [speed] | pause | stop | resume [speed]' }
    }

    const speedStr = rest[0]
    if (!speedStr) return { kind: 'recording', op: 'play.start', params: { path: file } }

    const speed = Number(speedStr)
    if (Number.isNaN(speed) || speed <= 0) {
      return { kind: 'error', message: 'usage: recording play <recordingFile.json5> [speed] (speed must be > 0)' }
    }

    return { kind: 'recording', op: 'play.start', params: { path: file, speed } }
  }

  return { kind: 'error', message: 'usage: recording status|start|record|load|play' }
}

export const printRecordingHelp = () => {
  console.log('  recording status')
  console.log('  recording start <macro.json5> [comment...]')
  console.log('  recording record <macro.json5> [comment...]')
  console.log('  recording record stop')
  console.log('  recording load <recordingFile.json5>')
  console.log('  recording play <recordingFile.json5> [speed]')
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

      if (fe?.stack) {
        console.log(fe.stack)
      }

      return
    }

    if (res?.data !== undefined) {
      logger?.info?.('recording', res.data)
      return
    }

    logger?.notice?.('recording', { ok: true })
  } catch (e) {
    const fe = formatError(e)
    console.log(fe?.message || 'recording_error')

    if (fe?.stack) {
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
