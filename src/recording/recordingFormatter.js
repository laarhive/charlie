// src/recording/recordingFormatter.js
import JSON5 from 'json5'
import crypto from 'node:crypto'

const OMIT = Symbol('omit')

const canonicalize = (v) => {
  if (Array.isArray(v)) {
    return v.map(canonicalize)
  }

  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      out[k] = canonicalize(v[k])
    }
    return out
  }

  return v
}

const findFirstDiff = (a, b, path = '$') => {
  if (a === b) return null

  // handle NaN
  if (Number.isNaN(a) && Number.isNaN(b)) return null

  const ta = typeof a
  const tb = typeof b

  if (ta !== tb) {
    return { path, a, b, reason: 'type mismatch' }
  }

  if (a === null || b === null) {
    if (a !== b) return { path, a, b, reason: 'null mismatch' }
    return null
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return { path, a, b, reason: 'array vs non-array' }
    }

    if (a.length !== b.length) {
      return { path, a: a.length, b: b.length, reason: 'array length mismatch' }
    }

    for (let i = 0; i < a.length; i++) {
      const d = findFirstDiff(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }

    return null
  }

  if (ta === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()

    if (ka.length !== kb.length) {
      return {
        path,
        a: ka,
        b: kb,
        reason: 'object key count mismatch',
      }
    }

    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) {
        return {
          path,
          a: ka,
          b: kb,
          reason: 'object keys mismatch',
        }
      }
    }

    for (const k of ka) {
      const d = findFirstDiff(a[k], b[k], `${path}.${k}`)
      if (d) return d
    }

    return null
  }

  // primitives (number/string/bool/bigint)
  if (a !== b) {
    return { path, a, b, reason: 'value mismatch' }
  }

  return null
}

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const isIdentifierKey = (k) => /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(k)

const formatKey = (k) => (isIdentifierKey(k) ? k : JSON5.stringify(k))

const indentOf = (n, unit) => unit.repeat(n)

const DIRECTIVES = new Set(['__layout', '__array'])

const normalizeLayout = (spec) => {
  const rows = spec?.__layout
  if (!Array.isArray(rows)) return []

  const out = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const keys = row.filter((k) => typeof k === 'string' && k.length > 0 && !DIRECTIVES.has(k))
    if (keys.length > 0) out.push(keys)
  }

  return out
}

const hasNestedSpec = (spec) => {
  if (!isPlainObject(spec)) return false

  for (const k of Object.keys(spec)) {
    if (DIRECTIVES.has(k)) continue
    return true
  }

  return false
}

const safeStringify = (value) => {
  try {
    const s = JSON5.stringify(value)
    if (s === undefined) return { ok: false, reason: 'unstringifiable (undefined output)' }
    return { ok: true, value: s }
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) }
  }
}

const renderScalar = ({ value, warn, path, asObjectProp }) => {
  const s = safeStringify(value)

  if (!s.ok) {
    warn(path, `unstringifiable value (${s.reason})`)
    return asObjectProp ? OMIT : 'null'
  }

  return s.value
}

const renderValue = ({
                       value,
                       spec,
                       indentLevel,
                       indentUnit,
                       warn,
                       path = '$',
                       asObjectProp = false,
                     }) => {
  if (Array.isArray(value)) {
    if (isPlainObject(spec) && spec.__array) {
      return renderArray({
        arr: value,
        spec,
        indentLevel,
        indentUnit,
        warn,
        path,
      })
    }

    return renderScalar({ value, warn, path, asObjectProp })
  }

  if (isPlainObject(value)) {
    if (isPlainObject(spec)) {
      return renderObject({
        obj: value,
        spec,
        indentLevel,
        indentUnit,
        warn,
        path,
      })
    }

    return renderScalar({ value, warn, path, asObjectProp })
  }

  if (isPlainObject(spec) && (spec.__array || spec.__layout || hasNestedSpec(spec))) {
    warn(path, 'spec expects structured value')
    return null
  }

  return renderScalar({ value, warn, path, asObjectProp })
}

const renderObject = ({
                        obj,
                        spec,
                        indentLevel,
                        indentUnit,
                        warn,
                        path,
                      }) => {
  if (!isPlainObject(obj)) {
    warn(path, 'expected object')
    return null
  }

  const layoutRows = normalizeLayout(spec)
  const layoutKeysFlat = layoutRows.flat()

  const layoutKeySet = new Set(layoutKeysFlat)
  const orderedKeys = [
    ...layoutKeysFlat,
    ...Object.keys(obj).filter((k) => !layoutKeySet.has(k)),
  ]

  const renderKeyValue = ({ k, childIndentLevel }) => {
    const childSpec = isPlainObject(spec?.[k]) ? spec[k] : null

    return renderValue({
      value: obj[k],
      spec: childSpec,
      indentLevel: childIndentLevel,
      indentUnit,
      warn,
      path: `${path}.${k}`,
      asObjectProp: true,
    })
  }

  const ind = indentOf(indentLevel, indentUnit)
  const indNext = indentOf(indentLevel + 1, indentUnit)

  const lines = []
  const emitted = new Set()

  const emitSingleKey = (k) => {
    if (emitted.has(k)) return true
    if (!(k in obj)) return true

    const rendered = renderKeyValue({
      k,
      childIndentLevel: indentLevel + 1,
    })

    if (rendered === null) return null
    emitted.add(k)

    if (rendered === OMIT) return true

    lines.push(`${indNext}${formatKey(k)}: ${rendered}`)
    return true
  }

  const emitRow = (rowKeys) => {
    const parts = []

    for (const k of rowKeys) {
      if (emitted.has(k)) continue
      if (!(k in obj)) continue

      const rendered = renderKeyValue({
        k,
        childIndentLevel: indentLevel + 1,
      })

      if (rendered === null) return null
      emitted.add(k)

      if (rendered === OMIT) continue

      parts.push([k, rendered])
    }

    if (parts.length === 0) return true

    const allSingleLine = parts.every(([, r]) => !r.includes('\n'))
    if (allSingleLine) {
      lines.push(
        `${indNext}${parts.map(([k, r]) => `${formatKey(k)}: ${r}`).join(', ')}`
      )
      return true
    }

    // fallback per-key for this row
    for (const [k, r] of parts) {
      lines.push(`${indNext}${formatKey(k)}: ${r}`)
    }

    return true
  }

  for (const row of layoutRows) {
    const ok = emitRow(row)
    if (ok === null) return null
  }

  // append semantics: emit remaining keys in layout+append order
  for (const k of orderedKeys) {
    const ok = emitSingleKey(k)
    if (ok === null) return null
  }

  return `{\n${lines.map((l, i) => (i < lines.length - 1 ? `${l},` : l)).join('\n')}\n${ind}}`
}

const renderArray = ({
                       arr,
                       spec,
                       indentLevel,
                       indentUnit,
                       warn,
                       path,
                     }) => {
  if (!Array.isArray(arr)) {
    warn(path, 'expected array')
    return null
  }

  const mode = spec.__array
  if (mode !== 'multiline' && mode !== 'inline') {
    warn(path, `invalid __array: ${String(mode)}`)
    return null
  }

  const ind = indentOf(indentLevel, indentUnit)
  const indNext = indentOf(indentLevel + 1, indentUnit)

  if (arr.length === 0) return '[]'

  const renderItem = (v, i) => {
    if (isPlainObject(v)) {
      return renderValue({
        value: v,
        spec,
        indentLevel: indentLevel + 1,
        indentUnit,
        warn,
        path: `${path}[${i}]`,
        asObjectProp: false,
      })
    }

    const rendered = renderScalar({
      value: v,
      warn,
      path: `${path}[${i}]`,
      asObjectProp: false,
    })

    // arrays don’t omit elements
    return rendered === OMIT ? 'null' : rendered
  }

  if (mode === 'inline') {
    const parts = []
    for (let i = 0; i < arr.length; i++) {
      const rendered = renderItem(arr[i], i)
      if (rendered === null) return null
      if (rendered.includes('\n')) {
        warn(`${path}[${i}]`, 'inline array element became multiline')
        return null
      }
      parts.push(rendered)
    }

    return `[${parts.join(', ')}]`
  }

  const lines = []
  for (let i = 0; i < arr.length; i++) {
    const rendered = renderItem(arr[i], i)
    if (rendered === null) return null

    const withIndent = rendered
      .split('\n')
      .map((l) => `${indNext}${l}`)
      .join('\n')

    lines.push(withIndent)
  }

  return `[\n${lines.map((l, i) => (i < lines.length - 1 ? `${l},` : l)).join('\n')}\n${ind}]`
}

const renderEvent = ({
                       event,
                       rawType,
                       spec,
                       indentLevel,
                       indentUnit,
                       logger,
                       warnedGlobal,
                     }) => {
  const warn = (path, msg) => {
    const key = `${rawType ?? 'unknown'}::${path}::${msg}`
    if (warnedGlobal.has(key)) return
    warnedGlobal.add(key)

    const line = `recording format warning (event i=${event?.i ?? '?'}, id=${event?.id ?? '?'}): ${msg} at ${path}`
    if (logger?.warn) logger.warn(line)
    else console.warn(line)
  }

  const rendered = renderValue({
    value: event,
    spec,
    indentLevel,
    indentUnit,
    warn,
    path: '$event',
    asObjectProp: false,
  })

  if (rendered === null) {
    const msg = `recording format fallback (event i=${event?.i ?? '?'}, id=${event?.id ?? '?'}): structural mismatch`
    if (logger?.warn) logger.warn(msg)
    else console.warn(msg)

    const pretty = JSON5.stringify(event, null, indentUnit.length)
    const ind = indentOf(indentLevel, indentUnit)

    return pretty
      .split('\n')
      .map((l, idx) => (idx === 0 ? l : `${ind}${l}`))
      .join('\n')
  }

  return rendered
}

const renderEventsBlock = ({
                             events,
                             formattersByRawType,
                             indentBase,
                             indentUnit,
                             logger,
                             warnedGlobal,
                           }) => {
  const ind = indentBase
  const indNext = `${indentBase}${indentUnit}`

  if (!Array.isArray(events) || events.length === 0) {
    return `${ind}events: []`
  }

  const lines = []
  lines.push(`${ind}events: [`)

  for (let idx = 0; idx < events.length; idx++) {
    const ev = events[idx]
    const rawType = ev?.raw?.type
    const spec = rawType ? formattersByRawType?.[rawType] : null

    let eventText
    if (!isPlainObject(spec)) {
      const key = `no-spec::${rawType ?? 'undefined'}`
      if (!warnedGlobal.has(key)) {
        warnedGlobal.add(key)

        const msg = `recording format fallback: no layout spec for raw.type=${rawType ?? 'undefined'}`
        if (logger?.warn) logger.warn(msg)
        else console.warn(msg)
      }

      const pretty = JSON5.stringify(ev, null, indentUnit.length)
      eventText = pretty
        .split('\n')
        .map((l) => `${indNext}${l}`)
        .join('\n')
    } else {
      const rendered = renderEvent({
        event: ev,
        rawType,
        spec,
        indentLevel: 2,
        indentUnit,
        logger,
        warnedGlobal,
      })

      eventText = rendered
        .split('\n')
        .map((l) => `${indNext}${l}`)
        .join('\n')
    }

    lines.push(idx < events.length - 1 ? `${eventText},` : eventText)
  }

  lines.push(`${ind}]`)
  return lines.join('\n')
}

export const formatRecording = ({
                                  rec,
                                  formattersByRawType,
                                  logger = null,
                                  verifyRoundTrip = false,
                                }) => {
  const indentUnit = '  '
  const warnedGlobal = new Set()

  const token = `__CHARLIE_EVENTS__${crypto.randomUUID()}__`
  const recStub = { ...rec, events: token }

  const base = JSON5.stringify(recStub, null, indentUnit.length)

  const quotedToken = JSON5.stringify(token)
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')

  const re = new RegExp(`(^[ \\t]*)events:\\s*${quotedToken}`, 'm')
  const m = base.match(re)

  if (!m) {
    const msg = 'recording formatter: could not locate events placeholder, falling back to JSON5.stringify(rec, null, 2)'
    if (logger?.warn) logger.warn(msg)
    else console.warn(msg)

    return JSON5.stringify(rec, null, indentUnit.length)
  }

  const indentBase = m[1]
  const eventsBlock = renderEventsBlock({
    events: rec?.events,
    formattersByRawType,
    indentBase,
    indentUnit,
    logger,
    warnedGlobal,
  })

  const out = base.replace(re, eventsBlock)

  if (verifyRoundTrip) {
    try {
      const parsedOut = JSON5.parse(out)
      const normalizedIn = JSON5.parse(JSON5.stringify(rec))
      const a = canonicalize(parsedOut)
      const b = canonicalize(normalizedIn)

      const diff = findFirstDiff(a, b)
      if (diff) {
        const logFn = logger?.notice ?? logger?.warn ?? console.warn
        logFn(
          `recording formatter: round-trip verification failed ${diff.path}: ${diff.reason}\n` +
          `  output: ${JSON.stringify(diff.a)}\n` +
          `  input:  ${JSON.stringify(diff.b)}`
        )
      }
    } catch (e) {
      const msg = `recording formatter: round-trip verification error: ${e?.message ?? String(e)}`
      if (logger?.notice) logger.notice(msg)
      else if (logger?.warn) logger.warn(msg)
      else console.warn(msg)
    }
  }

  return out
}
