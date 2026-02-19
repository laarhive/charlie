// public/dev/radar-planner/engagement-layer.js
import { worldToSvgY, polarToXY, toInternal, normalize } from "./geometry.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const normalizeDeg = function normalizeDeg(deg) {
  let a = Number(deg)
  if (!Number.isFinite(a)) a = 0
  a = a % 360
  if (a < 0) a += 360
  return a
}

// relDeg: 0 front, ±90 sides, 180 back
const radiusCmAtRel = function radiusCmAtRel(relDeg, ring) {
  const front = Number(ring.frontCm)
  const side = Number(ring.sideCm)
  const back = Number(ring.backCm)
  const p = Math.max(1.0, Math.min(6.0, Number(ring.p)))

  const c = Math.cos((relDeg * Math.PI) / 180)           // 1..-1
  const s = Math.abs(Math.sin((relDeg * Math.PI) / 180)) // 0..1

  const t = (c + 1) / 2
  const fb = back + (front - back) * Math.pow(t, p)

  const w = Math.pow(s, 1.6)
  return fb * (1 - w) + side * w
}

const ringPathD = function ringPathD(facingCwDeg, ring) {
  const pts = []
  const step = 1.5

  for (let rel = -180; rel <= 180; rel += step) {
    const absCw = normalizeDeg(facingCwDeg + rel)
    const r = radiusCmAtRel(rel, ring)
    const aInt = toInternal(absCw)
    const p = polarToXY(aInt, r)
    pts.push(p)
  }

  if (pts.length < 2) return ""

  let d = `M ${pts[0].x} ${worldToSvgY(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${worldToSvgY(pts[i].y)}`
  }
  d += " Z"
  return d
}

const drawRing = function drawRing(group, facingCwDeg, ring, fill, stroke) {
  const p = el("path")
  p.setAttribute("d", ringPathD(facingCwDeg, ring))
  p.setAttribute("fill", fill)
  p.setAttribute("stroke", stroke)
  p.setAttribute("stroke-width", "2")
  p.setAttribute("stroke-linejoin", "round")
  p.setAttribute("stroke-linecap", "round")
  group.appendChild(p)
}

const drawCharlieSemi = function drawCharlieSemi(group, facingCwDeg) {
  const r = 32

  const startCw = normalizeDeg(facingCwDeg - 90)
  const endCw = normalizeDeg(facingCwDeg + 90)

  const s = toInternal(startCw)
  const e = toInternal(endCw)

  const p1 = polarToXY(s, r)
  const p2 = polarToXY(e, r)

  // internal angles increase CCW; we want the shorter arc (180°)
  const d = `M 0 ${worldToSvgY(0)}
L ${p1.x} ${worldToSvgY(p1.y)}
A ${r} ${r} 0 0 1 ${p2.x} ${worldToSvgY(p2.y)}
Z`

  const path = el("path")
  path.setAttribute("d", d)
  path.setAttribute("fill", "rgba(0,220,255,0.26)")
  path.setAttribute("stroke", "rgba(255,255,255,0.55)")
  path.setAttribute("stroke-width", "2")
  group.appendChild(path)

  const tip = polarToXY(toInternal(facingCwDeg), r + 16)

  const txt = el("text")
  txt.setAttribute("x", `${tip.x}`)
  txt.setAttribute("y", `${worldToSvgY(tip.y)}`)
  txt.setAttribute("text-anchor", "middle")
  txt.setAttribute("dominant-baseline", "middle")
  txt.setAttribute("fill", "rgba(255,255,255,0.72)")
  txt.setAttribute("font-size", "12")
  txt.textContent = `${normalizeDeg(facingCwDeg)}°`
  group.appendChild(txt)
}

const drawFacingLine = function drawFacingLine(group, facingCwDeg) {
  const aInt = toInternal(facingCwDeg)
  const tip = polarToXY(aInt, 72)

  const l = el("line")
  l.setAttribute("x1", "0")
  l.setAttribute("y1", `${worldToSvgY(0)}`)
  l.setAttribute("x2", `${tip.x}`)
  l.setAttribute("y2", `${worldToSvgY(tip.y)}`)
  l.setAttribute("stroke", "rgba(0,220,255,0.70)")
  l.setAttribute("stroke-width", "2")
  l.setAttribute("stroke-dasharray", "6 6")
  group.appendChild(l)
}

const drawEngagementLayer = function drawEngagementLayer({ group, show, charlieFacingDeg }) {
  group.innerHTML = ""
  if (!show) return

  const facing = normalizeDeg(charlieFacingDeg)

  // Keep hardcoded rings
  const monitor = { frontCm: 600, sideCm: 260, backCm: 180, p: 1.6 }
  const arm = { frontCm: 420, sideCm: 180, backCm: 120, p: 2.0 }
  const speak = { frontCm: 300, sideCm: 120, backCm: 60, p: 2.8 }

  drawRing(group, facing, monitor, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.18)")
  drawRing(group, facing, arm, "rgba(255,255,255,0.06)", "rgba(255,255,255,0.24)")
  drawRing(group, facing, speak, "rgba(0,220,255,0.10)", "rgba(0,220,255,0.40)")

  drawCharlieSemi(group, facing)
  drawFacingLine(group, facing)
}

export { drawEngagementLayer }
