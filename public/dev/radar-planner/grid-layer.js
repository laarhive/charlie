// public/dev/radar-planner/grid-layer.js
import { worldToSvgY } from "./geometry.js"

const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const drawGridLayer = function drawGridLayer({ group, show, viewBox, stepCm, boldEveryCm }) {
  group.innerHTML = ""
  if (!show) return

  const step = Math.max(10, Number(stepCm) || 50)
  const boldEvery = Math.max(step, Number(boldEveryCm) || 100)

  const x0 = viewBox.x
  const y0 = viewBox.y
  const x1 = viewBox.x + viewBox.w
  const y1 = viewBox.y + viewBox.h

  const startX = Math.floor(x0 / step) * step
  const endX = Math.ceil(x1 / step) * step
  const startY = Math.floor(y0 / step) * step
  const endY = Math.ceil(y1 / step) * step

  for (let x = startX; x <= endX; x += step) {
    const isBold = (Math.abs(x) % boldEvery) === 0
    const l = el("line")
    l.setAttribute("x1", `${x}`)
    l.setAttribute("y1", `${worldToSvgY(y0)}`)
    l.setAttribute("x2", `${x}`)
    l.setAttribute("y2", `${worldToSvgY(y1)}`)
    l.setAttribute("stroke", isBold ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)")
    l.setAttribute("stroke-width", isBold ? "2" : "1")
    group.appendChild(l)
  }

  for (let y = startY; y <= endY; y += step) {
    const isBold = (Math.abs(y) % boldEvery) === 0
    const l = el("line")
    l.setAttribute("x1", `${x0}`)
    l.setAttribute("y1", `${worldToSvgY(y)}`)
    l.setAttribute("x2", `${x1}`)
    l.setAttribute("y2", `${worldToSvgY(y)}`)
    l.setAttribute("stroke", isBold ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)")
    l.setAttribute("stroke-width", isBold ? "2" : "1")
    group.appendChild(l)
  }
}

export { drawGridLayer }
