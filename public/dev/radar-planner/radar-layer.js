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

const splitArcSegments = function splitArcSegments(centerInternal, fovDeg) {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)
  if (start <= end) return [[start, end]]
  return [[start, 360], [0, end]]
}

const arcOnlyPathCentered = function arcOnlyPathCentered(startInternal, endInternal, r) {
  const p1 = polarToXY(startInternal, r)
  const p2 = polarToXY(endInternal, r)

  const span = normalize(endInternal - startInternal)
  const largeArc = span > 180 ? 1 : 0

  return `M ${p1.x} ${worldToSvgY(p1.y)}
A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${worldToSvgY(p2.y)}`
}

const sectorWedgePathCentered = function sectorWedgePathCentered(startInternal, endInternal, r) {
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

const svgTranslateForWorldOrigin = function svgTranslateForWorldOrigin(originWorld) {
  return `translate(${originWorld.x} ${worldToSvgY(originWorld.y)})`
}

const drawRadialCentered = function drawRadialCentered(group, angleInternal, r, stroke, dashed, transform) {
  const p = polarToXY(angleInternal, r)

  const l = el("line")
  l.setAttribute("x1", "0")
  l.setAttribute("y1", `${worldToSvgY(0)}`)
  l.setAttribute("x2", `${p.x}`)
  l.setAttribute("y2", `${worldToSvgY(p.y)}`)
  l.setAttribute("stroke", stroke)
  l.setAttribute("stroke-width", "2.5")
  if (dashed) l.setAttribute("stroke-dasharray", "10 8")
  if (transform) l.setAttribute("transform", transform)
  group.appendChild(l)
}

const drawAngleLabelCentered = function drawAngleLabelCentered(group, angleInternal, r, text, fill, transform) {
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
  if (transform) t.setAttribute("transform", transform)
  group.appendChild(t)
}

const sectorIntervals = function sectorIntervals(centerInternal, fovDeg) {
  const start = normalize(centerInternal - fovDeg / 2)
  const end = normalize(centerInternal + fovDeg / 2)
  if (start <= end) return [[start, end]]
  return [[start, 360], [0, end]]
}

const intersectIntervals = function intersectIntervals(aList, bList) {
  const out = []
  for (let i = 0; i < aList.length; i++) {
    for (let j = 0; j < bList.length; j++) {
      const s = Math.max(aList[i][0], bList[j][0])
      const e = Math.min(aList[i][1], bList[j][1])
      if (e > s) out.push([s, e])
    }
  }
  return out
}

const centerDistanceDeg = function centerDistanceDeg(aInternal, bInternal) {
  let d = normalize(bInternal - aInternal)
  if (d > 180) d = 360 - d
  return d
}

const overlapDegContinuous = function overlapDegContinuous(aInternal, bInternal, afov) {
  const d = centerDistanceDeg(aInternal, bInternal)
  return Math.max(0, afov - d)
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

  const bandOuter = radiusInset
  const bandInner = Math.max(0, bandOuter - 55)

  const afovArcR = Math.max(0, bandOuter - 2)

  const c = el("circle")
  c.setAttribute("cx", "0")
  c.setAttribute("cy", `${worldToSvgY(0)}`)
  c.setAttribute("r", `${radiusInset}`)
  c.setAttribute("fill", "none")
  c.setAttribute("stroke", "rgba(255,255,255,0.25)")
  c.setAttribute("stroke-width", "2")
  group.appendChild(c)

  if (showTicks) drawTicks45(group, radiusInset)

  // Clip only the shaded fills to the Charlie circle
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

  const gUnder = el("g")
  gClip.appendChild(gUnder)

  // IMPORTANT: top layer is NOT clipped, so radar-centered AFOV arcs remain visible
  const gOver = el("g")
  group.appendChild(gOver)

  const styles = [
    { fill: "rgba(255,0,0,0.10)", stroke: "rgba(255,0,0,0.55)" },
    { fill: "rgba(0,255,0,0.10)", stroke: "rgba(0,255,0,0.55)" },
    { fill: "rgba(0,0,255,0.10)", stroke: "rgba(0,0,255,0.55)" }
  ]

  const azInternal = azimuthCwDeg.map((a) => toInternal(normalizeDeg(a)))

  const tubeR = Number.isFinite(Number(tubeRadiusCm)) ? Number(tubeRadiusCm) : 0
  const originsWorld = azInternal.map((center) => polarToXY(center, tubeR))
  const transforms = originsWorld.map((o) => svgTranslateForWorldOrigin(o))

  // FOV wedges (shaded) - clipped
  azInternal.forEach((center, i) => {
    const segs = splitArcSegments(center, fovDeg)
    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", sectorWedgePathCentered(s, e, radiusInset))
      p.setAttribute("fill", styles[i].fill)
      p.setAttribute("stroke", "none")
      p.setAttribute("transform", transforms[i])
      gUnder.appendChild(p)
    })
  })

  // Overlap shading – clipped (Charlie centered)
  const drawPairOverlap = function drawPairOverlap(iA, iB, fill) {
    const aSegs = sectorIntervals(azInternal[iA], afov)
    const bSegs = sectorIntervals(azInternal[iB], afov)
    const segs = intersectIntervals(aSegs, bSegs)

    segs.forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", ringSegmentPath(s, e, bandInner, bandOuter))
      p.setAttribute("fill", fill)
      p.setAttribute("stroke", "none")
      gUnder.appendChild(p)
    })
  }

  drawPairOverlap(0, 1, "rgba(255,255,255,0.50)")
  drawPairOverlap(1, 2, "rgba(255,255,255,0.40)")
  drawPairOverlap(2, 0, "rgba(255,255,255,0.30)")

  // AFOV arcs + radials + labels (NOT clipped)
  azInternal.forEach((center, i) => {
    const start = normalize(center - afov / 2)
    const end = normalize(center + afov / 2)

    splitArcSegments(center, afov).forEach(([s, e]) => {
      const p = el("path")
      p.setAttribute("d", arcOnlyPathCentered(s, e, afovArcR))
      p.setAttribute("fill", "none")
      p.setAttribute("stroke", styles[i].stroke)
      p.setAttribute("stroke-width", "3")
      p.setAttribute("stroke-dasharray", "10 8")
      p.setAttribute("stroke-linecap", "round")
      p.setAttribute("stroke-linejoin", "round")
      p.setAttribute("transform", transforms[i])
      gOver.appendChild(p)
    })

    drawRadialCentered(gOver, start, bandOuter, styles[i].stroke, true, transforms[i])
    drawRadialCentered(gOver, end, bandOuter, styles[i].stroke, true, transforms[i])

    const labelR = radiusInset + 10
    drawAngleLabelCentered(
      group,
      start,
      labelR,
      `${toDisplay(start)}°`,
      "rgba(255,255,255,0.55)",
      transforms[i]
    )
    drawAngleLabelCentered(
      group,
      end,
      labelR,
      `${toDisplay(end)}°`,
      "rgba(255,255,255,0.55)",
      transforms[i]
    )
  })

  const ov01 = overlapDegContinuous(azInternal[0], azInternal[1], afov)
  const ov12 = overlapDegContinuous(azInternal[1], azInternal[2], afov)
  const ov20 = overlapDegContinuous(azInternal[2], azInternal[0], afov)

  if (onPairOverlap) onPairOverlap({ ov01, ov12, ov20 })
}

export { drawRadarLayer }
