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

const normalizeDeg = function normalizeDeg(deg) {
  let a = Number(deg)
  if (!Number.isFinite(a)) a = 0
  a = a % 360
  if (a < 0) a += 360
  return a
}

const inSector = function inSector(angleInternal, centerInternal, fovDeg) {
  return Math.abs(angleDiffSigned(angleInternal, centerInternal)) <= (fovDeg / 2)
}

const splitArcSegments = function splitArcSegments(centerInternal, fovDeg) {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)

  if (start <= end) return [[start, end]]
  return [[start, 360], [0, end]]
}

const sectorWedgePath = function sectorWedgePath(startInternal, endInternal, r, origin) {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  const ox = origin.x
  const oy = origin.y

  const x1 = p1.x + ox
  const y1 = p1.y + oy
  const x2 = p2.x + ox
  const y2 = p2.y + oy

  return `M ${ox} ${worldToSvgY(oy)}
L ${x1} ${worldToSvgY(y1)}
A ${r} ${r} 0 ${largeArc} 0 ${x2} ${worldToSvgY(y2)}
Z`
}

const arcOnlyPath = function arcOnlyPath(startInternal, endInternal, r, origin) {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  const x1 = p1.x + origin.x
  const y1 = p1.y + origin.y
  const x2 = p2.x + origin.x
  const y2 = p2.y + origin.y

  return `M ${x1} ${worldToSvgY(y1)}
A ${r} ${r} 0 ${largeArc} 0 ${x2} ${worldToSvgY(y2)}`
}

const drawRadial = function drawRadial(group, angleInternal, r, origin, stroke, dashed) {
  const p = polarToXY(angleInternal, r)

  const l = el("line")
  l.setAttribute("x1", `${origin.x}`)
  l.setAttribute("y1", `${worldToSvgY(origin.y)}`)
  l.setAttribute("x2", `${origin.x + p.x}`)
  l.setAttribute("y2", `${worldToSvgY(origin.y + p.y)}`)
  l.setAttribute("stroke", stroke)
  l.setAttribute("stroke-width", "2.5")
  if (dashed) l.setAttribute("stroke-dasharray", "10 8")
  group.appendChild(l)
}

const drawAngleLabel = function drawAngleLabel(group, angleInternal, r, origin, text, fill) {
  const p = polarToXY(angleInternal, r)

  const t = el("text")
  t.setAttribute("x", `${origin.x + p.x}`)
  t.setAttribute("y", `${worldToSvgY(origin.y + p.y)}`)
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  t.setAttribute("fill", fill)
  t.setAttribute("font-size", "12.5")
  t.setAttribute("font-weight", "400")
  t.textContent = text
  group.appendChild(t)
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

const drawRadarLayer = function drawRadarLayer({
                                                 group,
                                                 azimuthCwDeg,
                                                 fovDeg,
                                                 afovDeg,
                                                 radarRadiusCm,
                                                 showTicks,
                                                 tubeRadiusCm,
                                                 onPairOverlap
                                               }) {
  group.innerHTML = ""

  const radius = Math.max(10, Math.min(2000, Number(radarRadiusCm) || 200))
  const radiusInset = Math.max(0, radius - 1.5)

  const fov = 120
  const afov = Math.max(1, Math.min(fov, Number(afovDeg) || 100))

  const afovBandOuter = radiusInset
  const afovBandInner = Math.max(0, radiusInset - 55)

  // Reference circle
  const c = el("circle")
  c.setAttribute("cx", "0")
  c.setAttribute("cy", `${worldToSvgY(0)}`)
  c.setAttribute("r", `${radiusInset}`)
  c.setAttribute("fill", "none")
  c.setAttribute("stroke", "rgba(255,255,255,0.25)")
  c.setAttribute("stroke-width", "2")
  group.appendChild(c)

  if (showTicks) drawTicks45(group, radiusInset)

  // Clip to circle so nothing bleeds
  const defs = el("defs")
  const clip = el("clipPath")
  clip.setAttribute("id", "clipRadarCircle")

  const clipCircle = el("circle")
  clipCircle.setAttribute("cx", "0")
  clipCircle.setAttribute("cy", `${worldToSvgY(0)}`)
  clipCircle.setAttribute("r", `${radiusInset}`)
  clip.appendChild(clipCircle)
  defs.appendChild(clip)
  group.appendChild(defs)

  const gClip = el("g")
  gClip.setAttribute("clip-path", "url(#clipRadarCircle)")
  group.appendChild(gClip)

  // We want overlap UNDER the AFOV dashed bounds, so:
  // 1) draw FOV fills
  // 2) draw overlap band fills
  // 3) draw AFOV dashed bounds + labels on top

  const styles = [
    { fovFill: "rgba(255,0,0,0.08)", stroke: "rgba(255,0,0,0.60)" },
    { fovFill: "rgba(0,255,0,0.08)", stroke: "rgba(0,255,0,0.60)" },
    { fovFill: "rgba(0,0,255,0.08)", stroke: "rgba(0,0,255,0.60)" }
  ]

  const azCw = azimuthCwDeg.map((a) => normalizeDeg(a))
  const azInternal = azCw.map((a) => toInternal(a))

  const tubeR = Number.isFinite(Number(tubeRadiusCm)) ? Number(tubeRadiusCm) : 0
  const origins = azInternal.map((center) => polarToXY(center, tubeR))

  // FOV wedges
  azInternal.forEach((center, i) => {
    const origin = origins[i]
    splitArcSegments(center, fov).forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", sectorWedgePath(s, e, radiusInset, origin))
      p.setAttribute("fill", styles[i].fovFill)
      p.setAttribute("stroke", "none")
      gClip.appendChild(p)
    })
  })

  // Pairwise overlap (angular-only) rendered as AFOV band (inner..outer)
  const counts01 = new Array(360).fill(0)
  const counts12 = new Array(360).fill(0)
  const counts20 = new Array(360).fill(0)

  for (let a = 0; a < 360; a++) {
    const r0 = inSector(a, azInternal[0], afov)
    const r1 = inSector(a, azInternal[1], afov)
    const r2 = inSector(a, azInternal[2], afov)

    counts01[a] = (r0 && r1) ? 1 : 0
    counts12[a] = (r1 && r2) ? 1 : 0
    counts20[a] = (r2 && r0) ? 1 : 0
  }

  const drawOverlapBand = function drawOverlapBand(counts, fill) {
    const segs = segmentsFromPredicate(counts, (v) => v >= 1)
    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", ringSegmentPath(s, e, afovBandInner, afovBandOuter))
      p.setAttribute("fill", fill)
      p.setAttribute("stroke", "none")
      gClip.appendChild(p)
    })
  }

  drawOverlapBand(counts01, "rgba(255,255,255,0.20)")
  drawOverlapBand(counts12, "rgba(255,255,255,0.16)")
  drawOverlapBand(counts20, "rgba(255,255,255,0.12)")

  // AFOV bounds: dashed outer arc AND dashed inner arc (restored band)
  azInternal.forEach((center, i) => {
    const origin = origins[i]

    const start = normalize(center - afov / 2)
    const end = normalize(center + afov / 2)

    const drawArcAtR = (r) => {
      splitArcSegments(center, afov).forEach(([s, e]) => {
        const p = el("path")
        p.setAttribute("d", arcOnlyPath(s, e, r, origin))
        p.setAttribute("fill", "none")
        p.setAttribute("stroke", styles[i].stroke)
        p.setAttribute("stroke-width", "3")
        p.setAttribute("stroke-dasharray", "10 8")
        gClip.appendChild(p)
      })
    }

    drawArcAtR(afovBandOuter)
    drawArcAtR(afovBandInner)

    drawRadial(gClip, start, afovBandOuter, origin, styles[i].stroke, true)
    drawRadial(gClip, end, afovBandOuter, origin, styles[i].stroke, true)

    const labelR = radiusInset + 10
    drawAngleLabel(group, start, labelR, origin, `${toDisplay(start)}°`, "rgba(255,255,255,0.55)")
    drawAngleLabel(group, end, labelR, origin, `${toDisplay(end)}°`, "rgba(255,255,255,0.55)")
  })

  const overlapDeg = function overlapDeg(aInt, bInt) {
    let sum = 0
    for (let a = 0; a < 360; a++) {
      if (inSector(a, aInt, afov) && inSector(a, bInt, afov)) sum += 1
    }
    return sum
  }

  const ov01 = overlapDeg(azInternal[0], azInternal[1])
  const ov12 = overlapDeg(azInternal[1], azInternal[2])
  const ov20 = overlapDeg(azInternal[2], azInternal[0])

  if (onPairOverlap) onPairOverlap({ ov01, ov12, ov20 })
}

export { drawRadarLayer }
