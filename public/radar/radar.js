const WS_URL = 'ws://127.0.0.1:8787/ws?presence'

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
    trailTimeoutMs: 1500,

    // Debug counters
    rxFrames: 0,
    rxJsonOk: 0,
    rxBusOk: 0,
    rxTargetsOk: 0,
    rxValidTargets: 0,
    rxFirstFramesLogged: 0
  }
}

const readControls = function (state, els) {
  const trailEnabled = !!els.trailEnabled.checked
  const trailTimeoutMs = clamp(parseInt(els.trailTimeoutMs.value || '1500', 10), 50, 600000)
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

const enqueueIfChanged = function (state, id, xMm, yMm, ts) {
  ensurePerTarget(state, id)

  const prev = state.last.get(id)
  const changed = !prev || prev.xMm !== xMm || prev.yMm !== yMm

  if (!changed) {
    return
  }

  state.last.set(id, { xMm, yMm, ts })

  if (state.trailEnabled) {
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
  // Our fan is defined around "forward/up" (y+), with half-angle +/- fanAngleRad/2.
  // Canvas arc angles are measured from +x axis, increasing clockwise.
  // "Up" is -90deg (or 3π/2). The two edges are rotated around up.
  const up = -Math.PI / 2
  const half = view.fanAngleRad / 2

  const aLeft = up - half
  const aRight = up + half

  return { aLeft, aRight }
}

const arcBetween = function (ctx, cx, cy, r, a0, a1) {
  // Ensure we always draw the short arc from a0 -> a1 clockwise
  // (for our fan this is what we want)
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
    // i=0..rays spans -half..+half around "up"
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

  // Fan edge rays (slightly stronger)
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

  // Origin dot
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
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = withAlpha('#000000', 0.35)
    ctx.lineWidth = 2
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.stroke()
  }
}

const updateStatus = function (els, state) {
  const now = nowMs()

  // Only recompute the status text once per second
  if (state.uiLastStatusRenderMs && (now - state.uiLastStatusRenderMs) < 1000) {
    els.status.textContent = state.uiCachedStatusText
    return
  }

  state.uiLastStatusRenderMs = now

  const age = state.lastMsgTs ? (now - state.lastMsgTs) : null
  const linkState = state.ws && state.ws.readyState === WebSocket.OPEN ? 'open' : 'closed'
  const ageText = age === null ? 'n/a' : `${age}ms`

  state.uiCachedStatusText =
    `WS: ${linkState} | last msg age: ${ageText} | rxFrames: ${state.rxFrames} | jsonOk: ${state.rxJsonOk} | busOk: ${state.rxBusOk} | targetsOk: ${state.rxTargetsOk} | validTargets: ${state.rxValidTargets}`

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

  // Keep this strict, but now you can SEE if jsonOk increments but busOk doesn't
  if (msg.payload?.bus !== 'presence' || msg.payload?.event?.type !== 'presenceRaw:ld2450') {
    return
  }

  state.rxBusOk += 1

  const frames = msg.payload?.event?.payload?.frames
  const targets = frames?.targets
  if (!frames || !Array.isArray(targets)) {
    return
  }

  state.rxTargetsOk += 1

  const ts = typeof frames.ts === 'number' ? frames.ts : nowMs()

  for (const t of targets) {
    if (!t || t.valid !== true) {
      continue
    }

    if (typeof t.id !== 'number' || typeof t.xMm !== 'number' || typeof t.yMm !== 'number') {
      continue
    }

    state.rxValidTargets += 1
    enqueueIfChanged(state, t.id, t.xMm, t.yMm, ts)
  }
}

const connectWs = function (state, els) {
  if (state.ws) {
    try {
      state.ws.close()
    } catch (e) {}
  }

  els.status.textContent = `Connecting: ${WS_URL}`

  const ws = new WebSocket(WS_URL)
  state.ws = ws

  ws.addEventListener('open', () => {
    console.log('[radar] ws open')
  })

  ws.addEventListener('close', () => {
    console.log('[radar] ws close')
  })

  ws.addEventListener('error', (e) => {
    console.log('[radar] ws error', e)
  })

  ws.addEventListener('message', (ev) => {
    handleWsFrame(state, ev)
  })
}

const wireUi = function (state, els) {
  els.clear.addEventListener('click', () => {
    state.trail.clear()
  })

  els.reconnect.addEventListener('click', () => {
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
