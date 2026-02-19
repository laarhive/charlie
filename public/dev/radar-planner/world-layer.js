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

const drawCharlieDot = function drawCharlieDot(group) {
  const dot = el("circle")
  dot.setAttribute("cx", "0")
  dot.setAttribute("cy", `${worldToSvgY(0)}`)
  dot.setAttribute("r", "5")
  dot.setAttribute("fill", "rgba(0,220,255,0.90)")
  dot.setAttribute("stroke", "rgba(255,255,255,0.50)")
  dot.setAttribute("stroke-width", "1.5")
  group.appendChild(dot)

  addLabel(group, 0, -18, "Charlie")
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

  WORLD_OBJECTS.forEach((obj) => {
    if (obj.kind === "rect") drawRect(group, obj)
  })

  drawCharlieDot(group)
}

export { drawWorldLayer }
