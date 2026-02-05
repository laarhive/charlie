// public/dev/radar/radar.js
const DEFAULT_WS_URL = (() => {
  const isHttps = location.protocol === 'https:'
  const wsProto = isHttps ? 'wss:' : 'ws:'
  return `${wsProto}//${location.host}/ws?presence`
})()

const COLORS = {
  1: '#58d1ff',
  2: '#b07cff',
  3: '#6dff8f'
}

const getEl = function (id) {
  return document.getElementById(id)
}

const clamp = function (v, min, max) {
  return Math.max(min, Math.min(max, v))
}

const nowMs = function () {
  return Date.now()
}

const hexToRgb = function (hex) {
  const clean = (hex || '').replace('#', '').trim()

  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return { r, g, b }
  }

  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return { r, g, b }
}

const withAlpha = function (hex, a) {
  const rgb = hexToRgb(hex)
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

const createState = function () {
  return {
    ws: null,
    wsUrl: DEFAULT_WS_URL,

    closedByUser: false,
    reconnectAttempt: 0,
    reconnectTimer: null,

    lastMsgTs: 0,

    uiLastStatusRenderMs: 0,
    uiCachedStatusText: 'WS: closed | last msg age: n/a',

    // Per-target
    last: new Map(),   // id -> { xMm, yMm, ts }
    trail: new Map(),  // id -> [{ xMm, yMm, ts }]

    // View config
    fanAngleRad: (120 * Math.PI) / 180,
    maxDistanceMm: 6000,

    // Trail config
    trailEnabled: true,
    trailTimeoutMs: 2000,

    // Safety: if we stop receiving valid updates for a target, hide it anyway
    targetTimeoutMs: 1200,

    // Debug counters
    rxFrames: 0,
    rxJsonOk: 0,
    rxBusOk: 0,
    rxTargetsOk: 0,
    rxValidTargets: 0
  }
}

const readControls = function (state, els) {
  const trailEnabled = !!els.trailEnabled.checked
  const trailTimeoutMs = clamp(parseInt(els.trailTimeoutMs.value || '2000', 10), 50, 600000)
  const fanAngleDeg = clamp(parseInt(els.fanAngleDeg.value || '120', 10), 30, 180)
  const maxDistanceMm = clamp(parseInt(els.maxDistanceMm.value || '6000', 10), 500, 50000)

  state.trailEnabled = trailEnabled
  state.trailTimeoutMs = trailTimeoutMs
  state.fanAngleRad = (fanAngleDeg * Math.PI) / 180
  state.maxDistanceMm = maxDistanceMm
}

const ensurePerTarget = function (state, id) {
  if (!state.trail.has(id)) {
    state.trail.set(id, [])
  }

  if (!state.last.has(id)) {
    state.last.set(id, null)
  }
}

const clearTarget = function (state, id) {
  state.last.delete(id)
  state.trail.delete(id)
}

const enqueueObservation = function (state, id, xMm, yMm, ts) {
  ensurePerTarget(state, id)

  const prev = state.last.get(id)
  const changed = !prev || prev.xMm !== xMm || prev.yMm !== yMm

  // Always refresh "last seen" even if position is unchanged (prevents stale expiry for stationary targets)
  state.last.set(id, { xMm, yMm, ts })

  // Only add trail points when position changed (avoids flooding the trail while standing still)
  if (state.trailEnabled && changed) {
    const arr = state.trail.get(id)
    arr.push({ xMm, yMm, ts })
  }
}

const pruneTrails = function (state, now) {
  const timeout = state.trailTimeoutMs

  for (const [id, arr] of state.trail.entries()) {
    let keepFrom = 0

    while (keepFrom < arr.length && (now - arr[keepFrom].ts) > timeout) {
      keepFrom += 1
    }

    if (keepFrom > 0) {
      arr.splice(0, keepFrom)
    }

    if (arr.length === 0) {
      state.trail.delete(id)
    }
  }
}

const pruneStaleTargets = function (state, now) {
  const timeout = state.targetTimeoutMs

  for (const [id, last] of state.last.entries()) {
    if (!last) {
      continue
    }

    if ((now - last.ts) > timeout) {
      clearTarget(state, id)
    }
  }
}

const resizeCanvas = function (canvas, ctx) {
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const rect = canvas.getBoundingClientRect()

  canvas.width = Math.floor(rect.width * dpr)
  canvas.height = Math.floor(rect.height * dpr)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const computeView = function (canvas, state) {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  // Fan origin bottom-center, camera up
  const cx = w / 2
  const cy = h * 0.92

  // Fit max distance into ~86% of height
  const scalePxPerMm = (h * 0.86) / state.maxDistanceMm

  return {
    w,
    h,
    cx,
    cy,
    scalePxPerMm,
    maxDistanceMm: state.maxDistanceMm,
    fanAngleRad: state.fanAngleRad
  }
}

const mmToPx = function (xMm, yMm, view) {
  const px = view.cx + xMm * view.scalePxPerMm
  const py = view.cy - yMm * view.scalePxPerMm
  return { px, py }
}

const fanEdgeAnglesCanvas = function (view) {
  const up = -Math.PI / 2
  const half = view.fanAngleRad / 2

  const aLeft = up - half
  const aRight = up + half

  return { aLeft, aRight }
}

const arcBetween = function (ctx, cx, cy, r, a0, a1) {
  ctx.arc(cx, cy, r, a0, a1, false)
}

const pointInFan = function (xMm, yMm, view) {
  if (yMm < 0) {
    return false
  }

  const r = Math.hypot(xMm, yMm)
  if (r > view.maxDistanceMm) {
    return false
  }

  const angle = Math.atan2(xMm, yMm)
  return Math.abs(angle) <= view.fanAngleRad / 2
}

const drawGrid = function (ctx, view) {
  ctx.clearRect(0, 0, view.w, view.h)

  const { aLeft, aRight } = fanEdgeAnglesCanvas(view)

  const rings = 6
  for (let i = 1; i <= rings; i += 1) {
    const rMm = (view.maxDistanceMm * i) / rings
    const rPx = rMm * view.scalePxPerMm

    ctx.beginPath()
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(231, 238, 252, 0.10)' : 'rgba(231, 238, 252, 0.16)'
    ctx.lineWidth = 1

    arcBetween(ctx, view.cx, view.cy, rPx, aLeft, aRight)
    ctx.stroke()
  }

  const rays = 8
  for (let i = 0; i <= rays; i += 1) {
    const t = (i / rays) - 0.5
    const a = (-Math.PI / 2) + t * view.fanAngleRad

    const endXpx = view.cx + Math.cos(a) * (view.maxDistanceMm * view.scalePxPerMm)
    const endYpx = view.cy + Math.sin(a) * (view.maxDistanceMm * view.scalePxPerMm)

    ctx.beginPath()
    ctx.strokeStyle = i === Math.floor(rays / 2) ? 'rgba(231, 238, 252, 0.22)' : 'rgba(231, 238, 252, 0.08)'
    ctx.lineWidth = 1
    ctx.moveTo(view.cx, view.cy)
    ctx.lineTo(endXpx, endYpx)
    ctx.stroke()
  }

  const leftEndX = view.cx + Math.cos(aLeft) * (view.maxDistanceMm * view.scalePxPerMm)
  const leftEndY = view.cy + Math.sin(aLeft) * (view.maxDistanceMm * view.scalePxPerMm)

  const rightEndX = view.cx + Math.cos(aRight) * (view.maxDistanceMm * view.scalePxPerMm)
  const rightEndY = view.cy + Math.sin(aRight) * (view.maxDistanceMm * view.scalePxPerMm)

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(231, 238, 252, 0.22)'
  ctx.lineWidth = 1.5
  ctx.moveTo(view.cx, view.cy)
  ctx.lineTo(leftEndX, leftEndY)
  ctx.moveTo(view.cx, view.cy)
  ctx.lineTo(rightEndX, rightEndY)
  ctx.stroke()

  ctx.beginPath()
  ctx.fillStyle = 'rgba(231, 238, 252, 0.85)'
  ctx.arc(view.cx, view.cy, 3, 0, Math.PI * 2)
  ctx.fill()
}

const drawTrails = function (ctx, state, view, now) {
  if (!state.trailEnabled) {
    return
  }

  const timeout = state.trailTimeoutMs

  for (const [id, arr] of state.trail.entries()) {
    const color = COLORS[id] || '#ffffff'

    for (let i = 0; i < arr.length; i += 1) {
      const p = arr[i]
      if (!pointInFan(p.xMm, p.yMm, view)) {
        continue
      }

      const age = now - p.ts
      const t = clamp(1 - (age / timeout), 0, 1)

      const { px, py } = mmToPx(p.xMm, p.yMm, view)

      ctx.beginPath()
      ctx.fillStyle = withAlpha(color, 0.75 * t)
      ctx.arc(px, py, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

const drawCurrentDots = function (ctx, state, view) {
  for (const [id, last] of state.last.entries()) {
    if (!last) {
      continue
    }

    if (!pointInFan(last.xMm, last.yMm, view)) {
      continue
    }

    const color = COLORS[id] || '#ffffff'
    const { px, py } = mmToPx(last.xMm, last.yMm, view)

    ctx.beginPath()
    ctx.fillStyle = withAlpha(color, 1)
    ctx.arc(px, py, 8, 0, Math.PI * 2)
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = withAlpha('#000000', 0.35)
    ctx.lineWidth = 2
    ctx.arc(px, py, 8, 0, Math.PI * 2)
    ctx.stroke()
  }
}

const updateStatus = function (els, state) {
  const now = nowMs()

  if (state.uiLastStatusRenderMs && (now - state.uiLastStatusRenderMs) < 1000) {
    els.status.textContent = state.uiCachedStatusText
    return
  }

  state.uiLastStatusRenderMs = now

  const ageMs = state.lastMsgTs ? (now - state.lastMsgTs) : null
  const ageSec = ageMs === null ? null : Math.floor(ageMs / 1000)

  const linkState = state.ws && state.ws.readyState === WebSocket.OPEN ? 'open' : 'closed'
  const ageText = ageSec === null ? 'n/a' : `${ageSec}s`

  const url = (state.wsUrl || DEFAULT_WS_URL).trim()

  state.uiCachedStatusText =
    `WS: ${linkState} | last msg age: ${ageText} | rxFrames: ${state.rxFrames} | jsonOk: ${state.rxJsonOk} | busOk: ${state.rxBusOk} | targetsOk: ${state.rxTargetsOk} | validTargets: ${state.rxValidTargets} | ${url}`

  els.status.textContent = state.uiCachedStatusText
}

const parseMaybeJson = function (data) {
  if (typeof data !== 'string') {
    return { ok: false, value: null }
  }

  try {
    return { ok: true, value: JSON.parse(data) }
  } catch (e) {
    return { ok: false, value: null }
  }
}

const handleWsFrame = function (state, ev) {
  state.rxFrames += 1
  state.lastMsgTs = nowMs()

  const parsed = parseMaybeJson(ev.data)
  if (!parsed.ok) {
    return
  }

  state.rxJsonOk += 1

  const msg = parsed.value
  if (!msg) {
    return
  }

  if (msg.payload?.bus !== 'presence' || msg.payload?.event?.type !== 'presenceRaw:ld2450') {
    return
  }

  state.rxBusOk += 1

  const frames = msg.payload?.event?.payload?.frame
  const targets = frames?.targets
  if (!frames || !Array.isArray(targets)) {
    return
  }

  state.rxTargetsOk += 1

  const ts = typeof frames.ts === 'number' ? frames.ts : nowMs()

  for (const t of targets) {
    if (!t || typeof t.id !== 'number') {
      continue
    }

    // Explicit disappearance: clear last + trail for this id
    if (t.valid === false) {
      clearTarget(state, t.id)
      continue
    }

    if (t.valid !== true) {
      continue
    }

    if (typeof t.xMm !== 'number' || typeof t.yMm !== 'number') {
      continue
    }

    state.rxValidTargets += 1
    enqueueObservation(state, t.id, t.xMm, t.yMm, ts)
  }
}

const clearReconnectTimer = function (state) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
}

const backoffMs = function (attempt) {
  const min = 250
  const max = 10_000
  const exp = Math.min(max, min * Math.pow(2, attempt))
  const jitter = exp * 0.25 * (Math.random() * 2 - 1)
  return Math.max(min, Math.floor(exp + jitter))
}

const scheduleReconnect = function (state, els) {
  if (state.closedByUser) {
    return
  }

  clearReconnectTimer(state)
  const ms = backoffMs(state.reconnectAttempt)

  els.status.textContent = `WS: reconnecting in ${ms}ms`

  state.reconnectTimer = setTimeout(() => {
    state.reconnectAttempt += 1
    connectWs(state, els)
  }, ms)
}

const disconnectWs = function (state) {
  state.closedByUser = true
  clearReconnectTimer(state)

  if (!state.ws) {
    return
  }

  try { state.ws.close() } catch (e) {}
  state.ws = null
}

const connectWs = function (state, els) {
  const url = (state.wsUrl || DEFAULT_WS_URL).trim()
  if (!url) {
    return
  }

  state.closedByUser = false
  clearReconnectTimer(state)

  if (state.ws) {
    try { state.ws.close() } catch (e) {}
    state.ws = null
  }

  els.status.textContent = 'WS: connecting'

  const ws = new WebSocket(url)
  state.ws = ws

  ws.addEventListener('open', () => {
    state.reconnectAttempt = 0
  })

  ws.addEventListener('close', () => {
    state.ws = null
    scheduleReconnect(state, els)
  })

  ws.addEventListener('error', () => {
    // close usually follows
  })

  ws.addEventListener('message', (ev) => {
    handleWsFrame(state, ev)
  })
}

const wireUi = function (state, els) {
  els.clear.addEventListener('click', () => {
    state.trail.clear()
    state.last.clear()
  })

  els.reconnect.addEventListener('click', () => {
    if (state.ws) {
      disconnectWs(state)
      return
    }

    connectWs(state, els)
  })
}

const createEls = function () {
  const els = {
    canvas: getEl('c'),
    status: getEl('status'),

    trailEnabled: getEl('trailEnabled'),
    trailTimeoutMs: getEl('trailTimeoutMs'),
    fanAngleDeg: getEl('fanAngleDeg'),
    maxDistanceMm: getEl('maxDistanceMm'),

    clear: getEl('clear'),
    reconnect: getEl('reconnect'),

    s1: getEl('s1'),
    s2: getEl('s2'),
    s3: getEl('s3')
  }

  els.s1.style.background = COLORS[1]
  els.s2.style.background = COLORS[2]
  els.s3.style.background = COLORS[3]

  return els
}

const renderLoop = function (state, els, ctx) {
  readControls(state, els)

  const view = computeView(els.canvas, state)
  const now = nowMs()

  pruneTrails(state, now)
  pruneStaleTargets(state, now)

  drawGrid(ctx, view)
  drawTrails(ctx, state, view, now)
  drawCurrentDots(ctx, state, view)

  updateStatus(els, state)

  requestAnimationFrame(() => {
    renderLoop(state, els, ctx)
  })
}

const init = function () {
  const els = createEls()
  const state = createState()
  const ctx = els.canvas.getContext('2d')

  const onResize = function () {
    resizeCanvas(els.canvas, ctx)
  }

  onResize()
  window.addEventListener('resize', onResize)

  wireUi(state, els)
  connectWs(state, els)

  requestAnimationFrame(() => {
    renderLoop(state, els, ctx)
  })
}

init()
