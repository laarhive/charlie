// public/dev/radar-planner/engagement-layer.js
import { worldToSvgY, polarToXY, toInternal, normalize } from "./geometry.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const degToRad = (deg) => (deg * Math.PI) / 180

/* Hardcoded rings (cm) */
const RINGS = {
  monitor: { frontCm: 600, backCm: 350, p: 1.4 },
  arm: { frontCm: 450, backCm: 250, p: 1.6 },
  speak: { frontCm: 300, backCm: 40, p: 2.0 }
}

const STYLES = {
  monitor: { fill: "rgba(170,170,170,0.06)", stroke: "rgba(255,255,255,0.20)", dash: "10 8" },
  arm: { fill: "rgba(255,255,255,0.08)", stroke: "rgba(255,255,255,0.32)", dash: "8 7" },
  speak: { fill: "rgba(0,220,255,0.12)", stroke: "rgba(0,220,255,0.45)", dash: null }
}

const normalizeDeg = function normalizeDeg(deg) {
  let a = deg % 360
  if (a < 0) a += 360
  return a
}

const cosineWeightedRadius = function cosineWeightedRadius(thetaRad, ring) {
  const c = Math.cos(thetaRad)
  const base = (1 + c) / 2

  const pRaw = Number(ring.p)
  const p = Number.isFinite(pRaw) ? Math.max(0.6, Math.min(6, pRaw)) : 1.6

  const f = Math.pow(base, p)

  const front = Number(ring.frontCm)
  const back = Number(ring.backCm)

  if (!Number.isFinite(front) || !Number.isFinite(back)) return 0

  return back + ((front - back) * f)
}

// Uses geometry.js internal-angle polar pipeline
const ringPathD = function ringPathD({ facingCwDeg, stepDeg, ring }) {
  const step = Math.max(1, Math.min(15, Number(stepDeg) || 3))
  const pts = []

  const cwFromNorth = normalizeDeg(Number(facingCwDeg) || 0)
  const facingInt = toInternal(cwFromNorth)

  for (let rel = 0; rel <= 360; rel += step) {
    const theta = degToRad(rel)
    const r = cosineWeightedRadius(theta, ring)

    const aInt = normalize(facingInt + rel)
    pts.push(polarToXY(aInt, r))
  }

  if (pts.length < 2) return ""

  let d = `M ${pts[0].x} ${worldToSvgY(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    d += ` L ${p.x} ${worldToSvgY(p.y)}`
  }
  d += " Z"

  return d
}

const drawRing = function drawRing(group, { name, facingCwDeg }) {
  const ring = RINGS[name]
  const style = STYLES[name]

  const p = el("path")
  p.setAttribute("d", ringPathD({ facingCwDeg, stepDeg: 3, ring }))
  p.setAttribute("fill", style.fill)
  p.setAttribute("stroke", style.stroke)
  p.setAttribute("stroke-width", "2")

  if (style.dash) p.setAttribute("stroke-dasharray", style.dash)

  group.appendChild(p)
}

const drawCharlieSemi = function drawCharlieSemi(group, facingCwDeg) {
  const r = 32

  const facing = normalizeDeg(Number(facingCwDeg) || 0)

  // Geometry flipped 180°
  const flippedFacing = normalizeDeg(facing + 180)
  const centerInt = toInternal(flippedFacing)

  const startInt = normalize(centerInt - 90)
  const endInt = normalize(centerInt + 90)

  const p1 = polarToXY(startInt, r)
  const p2 = polarToXY(endInt, r)

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

  // Label stays in FRONT and shows FRONT angle value
  const frontInt = toInternal(facing)
  const tip = polarToXY(frontInt, r + 16)

  const txt = el("text")
  txt.setAttribute("x", `${tip.x}`)
  txt.setAttribute("y", `${worldToSvgY(tip.y)}`)
  txt.setAttribute("text-anchor", "middle")
  txt.setAttribute("dominant-baseline", "middle")
  txt.setAttribute("fill", "rgba(255,255,255,0.72)")
  txt.setAttribute("font-size", "12")
  txt.textContent = `${facing}°`
  group.appendChild(txt)
}

const drawFacingLine = function drawFacingLine(group, facingCwDeg) {
  const aInt = toInternal(normalizeDeg(Number(facingCwDeg) || 0))
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

  const facingCwDeg = Number.isFinite(Number(charlieFacingDeg)) ? Number(charlieFacingDeg) : 0

  drawRing(group, { name: "monitor", facingCwDeg })
  drawRing(group, { name: "arm", facingCwDeg })
  drawRing(group, { name: "speak", facingCwDeg })

  drawCharlieSemi(group, facingCwDeg)
  drawFacingLine(group, facingCwDeg)
}

export { drawEngagementLayer }
