// =========================
// CONFIG CONSTANTS
// =========================

const FOV = 120
const AFOV_DEFAULT = 120
const AZIMUTH_DEFAULT = [15, 75, 285]

// =========================

const svg = document.getElementById("radarSvg")

const ns = "http://www.w3.org/2000/svg"
const el = (tag) => (document.createElementNS(ns, tag))

const RGBA = {
  r: { fill: "rgba(255,0,0,0.12)", stroke: "rgba(255,0,0,0.55)" },
  g: { fill: "rgba(0,255,0,0.12)", stroke: "rgba(0,255,0,0.55)" },
  b: { fill: "rgba(0,0,255,0.12)", stroke: "rgba(0,0,255,0.55)" }
}

const OVERLAP2 = { fill: "rgba(255,255,255,0.50)", stroke: "rgba(255,255,255,0.80)" }
const OVERLAP3 = { fill: "rgba(255,215,0,0.62)", stroke: "rgba(255,215,0,0.90)" }

const STEP_DEG = 1

// SVG coordinate system (scalable via viewBox)
const VB = { w: 800, h: 800 }
const cx = VB.w / 2
const cy = VB.h / 2

const R = 320
const BAND_INNER = 270
const BAND_OUTER = 320
const TICK_INNER = 320
const TICK_OUTER = 338
const LABEL_R = 360

// 0° should be at NE
const ANGLE_OFFSET_DEG = 45

const normalize = (a) => ((a % 360) + 360) % 360

// User-facing degrees are CLOCKWISE.
// Internal math stays CCW to keep SVG arcs correct.
const toInternal = (cwDeg) => normalize(360 - cwDeg)
const toDisplay = (internalDeg) => normalize(360 - internalDeg)

const polarToXY = (internalDeg, r) => {
  // internalDeg is CCW, 0° at NE via offset
  const rad = (internalDeg + ANGLE_OFFSET_DEG) * Math.PI / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad)
  }
}

const angleDiffSigned = (aInternal, bInternal) => {
  return normalize(aInternal - bInternal + 180) - 180
}

const inSector = (angleInternal, centerInternal, fovDeg) => {
  const half = fovDeg / 2
  return Math.abs(angleDiffSigned(angleInternal, centerInternal)) <= half
}

const clearSvg = () => {
  svg.innerHTML = ""
}

const setText = (id, txt) => {
  const node = document.getElementById(id)
  if (node) node.textContent = txt
}

const readInputs = () => {
  const afovRaw = Number(document.getElementById("afovInput").value)
  const afov = Number.isFinite(afovRaw) ? Math.max(1, Math.min(359, afovRaw)) : AFOV_DEFAULT

  // Read user azimuths as CLOCKWISE degrees (can be <0 or >359)
  const cw0 = Number(document.getElementById("az0").value)
  const cw1 = Number(document.getElementById("az1").value)
  const cw2 = Number(document.getElementById("az2").value)

  // normalize + convert to internal CCW
  const az = [
    toInternal(normalize(cw0)),
    toInternal(normalize(cw1)),
    toInternal(normalize(cw2))
  ]

  return { afov, az }
}

const drawCircle = () => {
  const c = el("circle")
  c.setAttribute("cx", cx)
  c.setAttribute("cy", cy)
  c.setAttribute("r", R)
  c.setAttribute("fill", "none")
  c.setAttribute("stroke", "rgba(255,255,255,0.28)")
  c.setAttribute("stroke-width", "2")
  svg.appendChild(c)
}

const drawTicks45 = () => {
  const g = el("g")

  // Place ticks at internal positions but label clockwise values.
  for (let cw = 0; cw < 360; cw += 45) {
    const a = toInternal(cw)

    const p1 = polarToXY(a, TICK_INNER)
    const p2 = polarToXY(a, TICK_OUTER)

    const l = el("line")
    l.setAttribute("x1", p1.x)
    l.setAttribute("y1", p1.y)
    l.setAttribute("x2", p2.x)
    l.setAttribute("y2", p2.y)
    l.setAttribute("stroke", "rgba(255,255,255,0.22)")
    l.setAttribute("stroke-width", "2")
    g.appendChild(l)

    const tPos = polarToXY(a, R + 22)
    const t = el("text")
    t.setAttribute("x", tPos.x)
    t.setAttribute("y", tPos.y)
    t.setAttribute("fill", "rgba(255,255,255,0.45)")
    t.setAttribute("font-size", "11")
    t.setAttribute("font-weight", "400")
    t.setAttribute("text-anchor", "middle")
    t.setAttribute("dominant-baseline", "middle")
    t.textContent = `${cw}°`
    g.appendChild(t)
  }

  svg.appendChild(g)
}

const splitArcSegments = (centerInternal, fovDeg) => {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)

  if (start <= end) return [[start, end]]
  return [[start, 360], [0, end]]
}

// Filled wedge (center -> arc -> center). Good for FOV fill.
const sectorWedgePath = (startInternal, endInternal, r) => {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${cx} ${cy}
L ${p1.x} ${p1.y}
A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${p2.y}
Z`
}

// Arc-only path (no line to center). Used for AFOV outline to avoid extra radial lines.
const arcOnlyPath = (startInternal, endInternal, r) => {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${p1.x} ${p1.y}
A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${p2.y}`
}

const ringSegmentPath = (startInternal, endInternal, rInner, rOuter) => {
  const p1o = polarToXY(startInternal, rOuter)
  const p2o = polarToXY(endInternal, rOuter)
  const p2i = polarToXY(endInternal, rInner)
  const p1i = polarToXY(startInternal, rInner)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${p1o.x} ${p1o.y}
A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p2o.x} ${p2o.y}
L ${p2i.x} ${p2i.y}
A ${rInner} ${rInner} 0 ${largeArc} 1 ${p1i.x} ${p1i.y}
Z`
}

const drawSectorFill = (centerInternal, fovDeg, styles) => {
  const segs = splitArcSegments(centerInternal, fovDeg)

  segs.forEach(([s, e]) => {
    const p = el("path")
    p.setAttribute("d", sectorWedgePath(s, e, R))
    p.setAttribute("fill", styles.fill)
    p.setAttribute("stroke", "none")
    svg.appendChild(p)
  })
}

const drawArcOutline = (centerInternal, fovDeg, styles, dashed) => {
  const segs = splitArcSegments(centerInternal, fovDeg)

  segs.forEach(([s, e]) => {
    const p = el("path")
    p.setAttribute("d", arcOnlyPath(s, e, R))
    p.setAttribute("fill", "none")
    p.setAttribute("stroke", styles.stroke)
    p.setAttribute("stroke-width", "3")
    if (dashed) p.setAttribute("stroke-dasharray", "10 8")
    svg.appendChild(p)
  })
}

const drawBoundaryLine = (angleInternal, r0, r1, stroke) => {
  const p0 = polarToXY(angleInternal, r0)
  const p1 = polarToXY(angleInternal, r1)

  const l = el("line")
  l.setAttribute("x1", p0.x)
  l.setAttribute("y1", p0.y)
  l.setAttribute("x2", p1.x)
  l.setAttribute("y2", p1.y)
  l.setAttribute("stroke", stroke)
  l.setAttribute("stroke-width", "3")
  svg.appendChild(l)
}

const drawAngleLabel = (angleInternal, r, text, fill) => {
  const p = polarToXY(angleInternal, r)

  const t = el("text")
  t.setAttribute("x", p.x)
  t.setAttribute("y", p.y)
  t.setAttribute("fill", fill)
  t.setAttribute("font-size", "13")
  t.setAttribute("font-weight", "400")
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  t.textContent = text
  svg.appendChild(t)
}

const drawFovBoundaryAngles = (centerInternal, fovDeg, stroke, labelFill) => {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)

  drawBoundaryLine(start, 0, R, stroke)
  drawBoundaryLine(end, 0, R, stroke)

  // Labels shown in CLOCKWISE degrees
  drawAngleLabel(start, LABEL_R, `${toDisplay(start)}°`, "rgba(255,255,255,0.55)")
  drawAngleLabel(end, LABEL_R, `${toDisplay(end)}°`, "rgba(255,255,255,0.55)")
}

const drawAfovRadialsAndLabels = (centerInternal, fovDeg, stroke, labelFill) => {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)

  // Radials: center -> AFOV edge (radius R), not a wedge fill
  drawBoundaryLine(start, 0, R, stroke)
  drawBoundaryLine(end, 0, R, stroke)

  // Make AFOV radials visually distinct from FOV radials (dashed)
  const lines = svg.querySelectorAll("line")
  const lastTwo = [lines[lines.length - 2], lines[lines.length - 1]]
  lastTwo.forEach((ln) => {
    if (ln) ln.setAttribute("stroke-dasharray", "10 8")
  })

  // Labels in CLOCKWISE degrees
  drawAngleLabel(start, LABEL_R, `${toDisplay(start)}°`, labelFill)
  drawAngleLabel(end, LABEL_R, `${toDisplay(end)}°`, labelFill)
}

const computeVisibilityCounts = (azInternalList, afovDeg) => {
  const counts = new Array(360).fill(0)

  for (let a = 0; a < 360; a += STEP_DEG) {
    const aInternal = a
    let seen = 0

    for (let i = 0; i < azInternalList.length; i++) {
      if (inSector(aInternal, azInternalList[i], afovDeg)) seen++
    }

    counts[a] = seen
  }

  return counts
}

const segmentsFromPredicate = (counts, predicate) => {
  const segs = []
  let inSeg = false
  let start = 0

  for (let a = 0; a < 360; a++) {
    const ok = predicate(counts[a])

    if (ok && !inSeg) {
      inSeg = true
      start = a
    }

    if (!ok && inSeg) {
      inSeg = false
      segs.push([start, a])
    }
  }

  if (inSeg) segs.push([start, 360])

  if (segs.length >= 2) {
    const first = segs[0]
    const last = segs[segs.length - 1]
    if (first[0] === 0 && last[1] === 360) {
      const merged = [last[0], first[1]]
      segs.pop()
      segs.shift()
      segs.unshift(merged)
    }
  }

  return segs
}

const drawOverlapBands = (counts, show2, show3) => {
  const g = el("g")

  if (show2) {
    const seg2 = segmentsFromPredicate(counts, (c) => c >= 2)
    seg2.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", ringSegmentPath(s, e, BAND_INNER, BAND_OUTER))
      p.setAttribute("fill", OVERLAP2.fill)
      p.setAttribute("stroke", OVERLAP2.stroke)
      p.setAttribute("stroke-width", "2")
      g.appendChild(p)
    })
  }

  if (show3) {
    const seg3 = segmentsFromPredicate(counts, (c) => c >= 3)
    seg3.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", ringSegmentPath(s, e, BAND_INNER, BAND_OUTER))
      p.setAttribute("fill", OVERLAP3.fill)
      p.setAttribute("stroke", OVERLAP3.stroke)
      p.setAttribute("stroke-width", "2")
      g.appendChild(p)
    })
  }

  svg.appendChild(g)
}

const computeOverlapDegrees = (counts, threshold) => {
  let sum = 0
  for (let a = 0; a < 360; a += STEP_DEG) {
    if (counts[a] >= threshold) sum += STEP_DEG
  }
  return sum
}

const formatRange = (centerInternal, fovDeg) => {
  const s = normalize(centerInternal - fovDeg / 2)
  const e = normalize(centerInternal + fovDeg / 2)

  // Display clockwise degrees
  return `${toDisplay(s)}° → ${toDisplay(e)}°`
}

const render = () => {
  clearSvg()
  drawCircle()

  const showAxes = document.getElementById("showAxes").checked
  const showFov = document.getElementById("showFov").checked
  const showAfov = document.getElementById("showAfov").checked
  const showOverlap2 = document.getElementById("showOverlap2").checked
  const showOverlap3 = document.getElementById("showOverlap3").checked
  const showFovAngles = document.getElementById("showFovAngles").checked

  const { afov, az } = readInputs()

  setText("fovVal", `${FOV}`)

  setText("anglesR0", `FOV ${formatRange(az[0], FOV)} | AFOV ${formatRange(az[0], afov)}`)
  setText("anglesR1", `FOV ${formatRange(az[1], FOV)} | AFOV ${formatRange(az[1], afov)}`)
  setText("anglesR2", `FOV ${formatRange(az[2], FOV)} | AFOV ${formatRange(az[2], afov)}`)

  if (showAxes) drawTicks45()

  const counts = computeVisibilityCounts(az, afov)

  if (showFov) {
    drawSectorFill(az[0], FOV, RGBA.r)
    drawSectorFill(az[1], FOV, RGBA.g)
    drawSectorFill(az[2], FOV, RGBA.b)
  }

  drawOverlapBands(counts, showOverlap2, showOverlap3)

  // AFOV outline only (no boundary lines/labels)
  if (showAfov) {
    drawArcOutline(az[0], afov, RGBA.r, true)
    drawAfovRadialsAndLabels(az[0], afov, RGBA.r.stroke, "rgba(255,0,0,0.95)")

    drawArcOutline(az[1], afov, RGBA.g, true)
    drawAfovRadialsAndLabels(az[1], afov, RGBA.g.stroke, "rgba(0,255,0,0.95)")

    drawArcOutline(az[2], afov, RGBA.b, true)
    drawAfovRadialsAndLabels(az[2], afov, RGBA.b.stroke, "rgba(120,160,255,0.95)")
  }

  // FOV boundary lines + labels (kept)
  if (showFovAngles) {
    drawFovBoundaryAngles(az[0], FOV, RGBA.r.stroke, "rgba(255,0,0,0.95)")
    drawFovBoundaryAngles(az[1], FOV, RGBA.g.stroke, "rgba(0,255,0,0.95)")
    drawFovBoundaryAngles(az[2], FOV, RGBA.b.stroke, "rgba(120,160,255,0.95)")
  }

  const ov2 = computeOverlapDegrees(counts, 2)
  const ov3 = computeOverlapDegrees(counts, 3)

  setText("overlap2Val", `${ov2}°`)
  setText("overlap3Val", `${ov3}°`)
}

const bind = () => {
  const ids = [
    "afovInput",
    "az0",
    "az1",
    "az2",
    "showFov",
    "showAfov",
    "showOverlap2",
    "showOverlap3",
    "showAxes",
    "showFovAngles"
  ]

  ids.forEach((id) => {
    const node = document.getElementById(id)
    if (!node) return
    node.addEventListener("input", render)
    node.addEventListener("change", render)
  })

  document.getElementById("afovInput").value = `${AFOV_DEFAULT}`
  document.getElementById("az0").value = `${AZIMUTH_DEFAULT[0]}`
  document.getElementById("az1").value = `${AZIMUTH_DEFAULT[1]}`
  document.getElementById("az2").value = `${AZIMUTH_DEFAULT[2]}`
}

bind()
render()
