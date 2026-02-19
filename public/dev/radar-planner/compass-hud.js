// public/dev/radar-planner/compass-hud.js
import { worldToSvgY, toInternal, polarToXY, normalize } from "./geometry.js"
import { DEFAULTS } from "./scene-state.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const drawArrow = function drawArrow(group, cx, cy, angleInternalDeg, len) {
  const tip = polarToXY(angleInternalDeg, len)
  const tail = polarToXY(normalize(angleInternalDeg + 180), len * 0.55)

  const x1 = cx + tail.x
  const y1 = cy + tail.y
  const x2 = cx + tip.x
  const y2 = cy + tip.y

  const shaft = el("line")
  shaft.setAttribute("x1", `${x1}`)
  shaft.setAttribute("y1", `${worldToSvgY(y1)}`)
  shaft.setAttribute("x2", `${x2}`)
  shaft.setAttribute("y2", `${worldToSvgY(y2)}`)
  shaft.setAttribute("stroke", "rgba(255,255,255,0.85)")
  shaft.setAttribute("stroke-width", "2.5")
  group.appendChild(shaft)

  // Red head triangle
  const headW = 6.5
  const headL = 10

  const left = polarToXY(normalize(angleInternalDeg + 90), headW)
  const right = polarToXY(normalize(angleInternalDeg - 90), headW)
  const back = polarToXY(normalize(angleInternalDeg + 180), headL)

  const p1 = { x: x2, y: y2 }
  const p2 = { x: x2 + back.x + left.x, y: y2 + back.y + left.y }
  const p3 = { x: x2 + back.x + right.x, y: y2 + back.y + right.y }

  const tri = el("path")
  tri.setAttribute(
    "d",
    `M ${p1.x} ${worldToSvgY(p1.y)} L ${p2.x} ${worldToSvgY(p2.y)} L ${p3.x} ${worldToSvgY(p3.y)} Z`
  )
  tri.setAttribute("fill", "rgba(255,60,60,0.95)")
  tri.setAttribute("stroke", "rgba(0,0,0,0.35)")
  tri.setAttribute("stroke-width", "1")
  group.appendChild(tri)
}

const drawCompassHUD = function drawCompassHUD({ group, viewBox }) {
  group.innerHTML = ""

  // Place inside existing viewBox corner (does NOT affect camera extents)
  const size = 34
  const pad = 10

  const cx = viewBox.x + viewBox.w - pad - size
  const cy = viewBox.y + pad + size

  const bg = el("circle")
  bg.setAttribute("cx", `${cx}`)
  bg.setAttribute("cy", `${worldToSvgY(cy)}`)
  bg.setAttribute("r", `${size}`)
  bg.setAttribute("fill", "rgba(0,0,0,0.30)")
  bg.setAttribute("stroke", "rgba(255,255,255,0.22)")
  bg.setAttribute("stroke-width", "2")
  group.appendChild(bg)

  const trueNInternal = toInternal(DEFAULTS.trueNorthCwDeg)

  drawArrow(group, cx, cy, trueNInternal, size - 9)

  const label = el("text")
  label.setAttribute("x", `${cx}`)
  label.setAttribute("y", `${worldToSvgY(cy + size + 12)}`)
  label.setAttribute("text-anchor", "middle")
  label.setAttribute("dominant-baseline", "middle")
  label.setAttribute("fill", "rgba(255,255,255,0.68)")
  label.setAttribute("font-size", "12")
  label.textContent = `N ${DEFAULTS.trueNorthCwDeg}°`
  group.appendChild(label)
}

export { drawCompassHUD }
