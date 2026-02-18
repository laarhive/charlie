// public/dev/radar-planner/radar-layer.js
import {
  normalize,
  worldToSvgY,
  polarToXY,
  angleDiffSigned,
  toInternal,
  toDisplay
} from "./geometry.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const splitArcSegments = function splitArcSegments(centerInternal, fovDeg) {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)

  if (start <= end) return [[start, end]]
  return [[start, 360], [0, end]]
}

const arcOnlyPath = function arcOnlyPath(startInternal, endInternal, r) {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${p1.x} ${worldToSvgY(p1.y)}
A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${worldToSvgY(p2.y)}`
}

const sectorWedgePath = function sectorWedgePath(startInternal, endInternal, r) {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M 0 ${worldToSvgY(0)}
L ${p1.x} ${worldToSvgY(p1.y)}
A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${worldToSvgY(p2.y)}
Z`
}

const ringSegmentPath = function ringSegmentPath(startInternal, endInternal, rInner, rOuter) {
  const p1o = polarToXY(startInternal, rOuter)
  const p2o = polarToXY(endInternal, rOuter)
  const p2i = polarToXY(endInternal, rInner)
  const p1i = polarToXY(startInternal, rInner)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${p1o.x} ${worldToSvgY(p1o.y)}
A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p2o.x} ${worldToSvgY(p2o.y)}
L ${p2i.x} ${worldToSvgY(p2i.y)}
A ${rInner} ${rInner} 0 ${largeArc} 1 ${p1i.x} ${worldToSvgY(p1i.y)}
Z`
}

const inSector = function inSector(angleInternal, centerInternal, fovDeg) {
  return Math.abs(angleDiffSigned(angleInternal, centerInternal)) <= (fovDeg / 2)
}

const drawTicks45 = function drawTicks45(group, r) {
  const tickInner = r
  const tickOuter = r + 18
  const labelR = r + 10

  for (let cw = 0; cw < 360; cw += 45) {
    const a = toInternal(cw)
    const p1 = polarToXY(a, tickInner)
    const p2 = polarToXY(a, tickOuter)

    const l = el("line")
    l.setAttribute("x1", `${p1.x}`)
    l.setAttribute("y1", `${worldToSvgY(p1.y)}`)
    l.setAttribute("x2", `${p2.x}`)
    l.setAttribute("y2", `${worldToSvgY(p2.y)}`)
    l.setAttribute("stroke", "rgba(255,255,255,0.28)")
    l.setAttribute("stroke-width", "2")
    group.appendChild(l)

    const pt = polarToXY(a, labelR)
    const t = el("text")
    t.setAttribute("x", `${pt.x}`)
    t.setAttribute("y", `${worldToSvgY(pt.y)}`)
    t.setAttribute("text-anchor", "middle")
    t.setAttribute("dominant-baseline", "middle")
    t.setAttribute("fill", "rgba(255,255,255,0.38)")
    t.setAttribute("font-size", "13")
    t.setAttribute("font-weight", "400")
    t.textContent = `${cw}°`
    group.appendChild(t)
  }
}

const drawRadial = function drawRadial(group, angleInternal, r, stroke, dashed) {
  const p = polarToXY(angleInternal, r)

  const l = el("line")
  l.setAttribute("x1", "0")
  l.setAttribute("y1", `${worldToSvgY(0)}`)
  l.setAttribute("x2", `${p.x}`)
  l.setAttribute("y2", `${worldToSvgY(p.y)}`)
  l.setAttribute("stroke", stroke)
  l.setAttribute("stroke-width", "2.5")
  if (dashed) l.setAttribute("stroke-dasharray", "10 8")
  group.appendChild(l)
}

const drawAngleLabel = function drawAngleLabel(group, angleInternal, r, text, fill) {
  const p = polarToXY(angleInternal, r)

  const t = el("text")
  t.setAttribute("x", `${p.x}`)
  t.setAttribute("y", `${worldToSvgY(p.y)}`)
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  t.setAttribute("fill", fill)
  t.setAttribute("font-size", "12.5")
  t.setAttribute("font-weight", "400")
  t.textContent = text
  group.appendChild(t)
}

const computeVisibilityCounts = function computeVisibilityCounts(azInternalList, afovDeg) {
  const counts = new Array(360).fill(0)

  for (let a = 0; a < 360; a++) {
    let seen = 0
    for (let i = 0; i < azInternalList.length; i++) {
      if (inSector(a, azInternalList[i], afovDeg)) seen++
    }
    counts[a] = seen
  }

  return counts
}

const segmentsFromPredicate = function segmentsFromPredicate(counts, predicate) {
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

const computeOverlapDegrees = function computeOverlapDegrees(counts, threshold) {
  let sum = 0
  for (let a = 0; a < 360; a++) {
    if (counts[a] >= threshold) sum += 1
  }
  return sum
}

const drawRadarLayer = function drawRadarLayer({
                                                 group,
                                                 azimuthCwDeg,
                                                 fovDeg,
                                                 afovDeg,
                                                 radarRadiusCm,
                                                 showOverlap2,
                                                 showOverlap3,
                                                 showTicks,
                                                 showAfovRadials,
                                                 onStats
                                               }) {
  group.innerHTML = ""

  const radius = Math.max(10, Math.min(2000, Number(radarRadiusCm) || 200))
  const bandOuter = radius
  const bandInner = Math.max(0, radius - 55)

  const c = el("circle")
  c.setAttribute("cx", "0")
  c.setAttribute("cy", `${worldToSvgY(0)}`)
  c.setAttribute("r", `${radius}`)
  c.setAttribute("fill", "none")
  c.setAttribute("stroke", "rgba(255,255,255,0.25)")
  c.setAttribute("stroke-width", "2")
  group.appendChild(c)

  if (showTicks) drawTicks45(group, radius)

  const styles = [
    { fill: "rgba(255,0,0,0.10)", stroke: "rgba(255,0,0,0.55)" },
    { fill: "rgba(0,255,0,0.10)", stroke: "rgba(0,255,0,0.55)" },
    { fill: "rgba(0,0,255,0.10)", stroke: "rgba(0,0,255,0.55)" }
  ]

  const azInternal = azimuthCwDeg.map((a) => toInternal(normalize(a)))

  azInternal.forEach((center, i) => {
    const segs = splitArcSegments(center, fovDeg)
    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", sectorWedgePath(s, e, radius))
      p.setAttribute("fill", styles[i].fill)
      p.setAttribute("stroke", "none")
      group.appendChild(p)
    })
  })

  const counts = computeVisibilityCounts(azInternal, afovDeg)

  const drawBand = function drawBand(threshold, fill, stroke) {
    const segs = segmentsFromPredicate(counts, (c) => c >= threshold)
    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", ringSegmentPath(s, e, bandInner, bandOuter))
      p.setAttribute("fill", fill)
      p.setAttribute("stroke", stroke)
      p.setAttribute("stroke-width", "2")
      group.appendChild(p)
    })
  }

  if (showOverlap2) drawBand(2, "rgba(255,255,255,0.50)", "rgba(255,255,255,0.80)")
  if (showOverlap3) drawBand(3, "rgba(255,215,0,0.62)", "rgba(255,215,0,0.90)")

  azInternal.forEach((center, i) => {
    const segs = splitArcSegments(center, afovDeg)
    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", arcOnlyPath(s, e, radius))
      p.setAttribute("fill", "none")
      p.setAttribute("stroke", styles[i].stroke)
      p.setAttribute("stroke-width", "3")
      p.setAttribute("stroke-dasharray", "10 8")
      group.appendChild(p)
    })

    if (showAfovRadials) {
      const start = normalize(center - afovDeg / 2)
      const end = normalize(center + afovDeg / 2)

      drawRadial(group, start, radius, styles[i].stroke, true)
      drawRadial(group, end, radius, styles[i].stroke, true)

      const labelR = radius + 10
      drawAngleLabel(group, start, labelR, `${toDisplay(start)}°`, "rgba(255,255,255,0.55)")
      drawAngleLabel(group, end, labelR, `${toDisplay(end)}°`, "rgba(255,255,255,0.55)")
    }
  })

  const ov2 = computeOverlapDegrees(counts, 2)
  const ov3 = computeOverlapDegrees(counts, 3)

  if (onStats) onStats({ ov2, ov3 })
}

export { drawRadarLayer }
