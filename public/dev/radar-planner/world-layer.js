// public/dev/radar-planner/world-layer.js
import { worldToSvgY } from "./geometry.js"
import { addPatterns } from "./patterns.js"
import { WORLD_OBJECTS } from "./scene-objects.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const FILL = {
  hedge: "url(#patHedge)",
  roses: "url(#patRoses)",
  sidewalk: "url(#patSidewalk)",
  road: "url(#patRoad)",
  terrace: "url(#patDeck)",
  walkway: "url(#patDeckLight)",
  restaurant: "url(#patRestaurant)",
  door: "url(#patDoor)"
}

// Default (unchecked) is more vivid. Checked makes it less intrusive.
const OPACITY = {
  hedge: 0.60,
  roses: 0.60,
  sidewalk: 0.50,
  road: 0.45,
  terrace: 0.55,
  walkway: 0.52,
  restaurant: 0.52,
  door: 0.75
}

const addLabel = function addLabel(group, x, y, text) {
  const t = el("text")
  t.setAttribute("x", x)
  t.setAttribute("y", worldToSvgY(y))
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  t.setAttribute("fill", "rgba(255,255,255,0.60)")
  t.setAttribute("font-size", "13")
  t.setAttribute("font-weight", "400")
  t.textContent = text
  group.appendChild(t)
}

const drawRect = function drawRect(group, obj) {
  const r = el("rect")
  r.setAttribute("x", obj.x1)
  r.setAttribute("y", worldToSvgY(obj.y2))
  r.setAttribute("width", obj.x2 - obj.x1)
  r.setAttribute("height", obj.y2 - obj.y1)
  r.setAttribute("fill", FILL[obj.cls] || "rgba(255,255,255,0.1)")
  r.setAttribute("opacity", `${OPACITY[obj.cls] ?? 0.5}`)
  group.appendChild(r)

  if (obj.label) {
    const at = obj.labelAt || { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 }
    addLabel(group, at.x, at.y, obj.label)
  }
}

const drawCharlie = function drawCharlie(group) {
  const r = 30
  const facingDeg = 45
  const startDeg = facingDeg - 90
  const endDeg = facingDeg + 90

  const p1 = { x: r * Math.cos(startDeg * Math.PI / 180), y: r * Math.sin(startDeg * Math.PI / 180) }
  const p2 = { x: r * Math.cos(endDeg * Math.PI / 180), y: r * Math.sin(endDeg * Math.PI / 180) }

  const path = el("path")
  const d = `M 0 ${worldToSvgY(0)}
L ${p1.x} ${worldToSvgY(p1.y)}
A ${r} ${r} 0 0 0 ${p2.x} ${worldToSvgY(p2.y)}
Z`

  path.setAttribute("d", d)
  path.setAttribute("fill", "rgba(0,220,255,0.38)")
  path.setAttribute("stroke", "rgba(255,255,255,0.60)")
  path.setAttribute("stroke-width", "2")
  group.appendChild(path)

  const fx = r * Math.cos(facingDeg * Math.PI / 180)
  const fy = r * Math.sin(facingDeg * Math.PI / 180)

  const face = el("line")
  face.setAttribute("x1", "0")
  face.setAttribute("y1", `${worldToSvgY(0)}`)
  face.setAttribute("x2", `${fx}`)
  face.setAttribute("y2", `${worldToSvgY(fy)}`)
  face.setAttribute("stroke", "rgba(0,220,255,0.55)")
  face.setAttribute("stroke-width", "2")
  face.setAttribute("stroke-dasharray", "6 6")
  group.appendChild(face)

  addLabel(group, 0, 0, "Charlie")
}

const applyWorldTone = function applyWorldTone(group, lessIntrusive) {
  if (lessIntrusive) {
    group.setAttribute("opacity", "0.80")
    group.style.filter = "saturate(0.75) brightness(1.05)"
    return
  }

  group.setAttribute("opacity", "1")
  group.style.filter = "none"
}

const drawWorldLayer = function drawWorldLayer({ svg, group, dim }) {
  addPatterns(svg)
  group.innerHTML = ""

  applyWorldTone(group, dim)

  drawCharlie(group)

  WORLD_OBJECTS.forEach((obj) => {
    if (obj.kind === "rect") drawRect(group, obj)
  })
}

export { drawWorldLayer }
