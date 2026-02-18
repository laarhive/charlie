// public/dev/radar-planner/patterns.js
const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const addPatterns = function addPatterns(svg) {
  if (svg.querySelector("defs")) return

  const defs = el("defs")

  const pattern = function pattern(id, w, h) {
    const p = el("pattern")
    p.setAttribute("id", id)
    p.setAttribute("width", w)
    p.setAttribute("height", h)
    p.setAttribute("patternUnits", "userSpaceOnUse")
    defs.appendChild(p)
    return p
  }

  const rect = function rect(x, y, w, h, fill) {
    const r = el("rect")
    r.setAttribute("x", x)
    r.setAttribute("y", y)
    r.setAttribute("width", w)
    r.setAttribute("height", h)
    r.setAttribute("fill", fill)
    return r
  }

  const circle = function circle(cx, cy, r, fill) {
    const c = el("circle")
    c.setAttribute("cx", cx)
    c.setAttribute("cy", cy)
    c.setAttribute("r", r)
    c.setAttribute("fill", fill)
    return c
  }

  const line = function line(x1, y1, x2, y2, stroke, sw = 1) {
    const l = el("line")
    l.setAttribute("x1", x1)
    l.setAttribute("y1", y1)
    l.setAttribute("x2", x2)
    l.setAttribute("y2", y2)
    l.setAttribute("stroke", stroke)
    l.setAttribute("stroke-width", sw)
    return l
  }

  const pH = pattern("patHedge", 16, 16)
  pH.appendChild(rect(0, 0, 16, 16, "#3fbf6f"))
  pH.appendChild(circle(4, 5, 2, "#2e9f57"))
  pH.appendChild(circle(12, 6, 2, "#2e9f57"))
  pH.appendChild(circle(8, 12, 2, "#2e9f57"))

  const pR = pattern("patRoses", 18, 18)
  pR.appendChild(rect(0, 0, 18, 18, "#ff7aa8"))
  pR.appendChild(circle(6, 6, 2.2, "#ff2e63"))
  pR.appendChild(circle(12, 10, 2.0, "#ff2e63"))
  pR.appendChild(circle(9, 14, 1.8, "#ff99bb"))

  const pS = pattern("patSidewalk", 30, 30)
  pS.appendChild(rect(0, 0, 30, 30, "#d9d9d9"))
  pS.appendChild(line(0, 0, 30, 0, "#bfbfbf"))
  pS.appendChild(line(0, 15, 30, 15, "#cfcfcf"))
  pS.appendChild(line(0, 0, 0, 30, "#bfbfbf"))
  pS.appendChild(line(15, 0, 15, 30, "#cfcfcf"))

  const pRd = pattern("patRoad", 40, 40)
  pRd.appendChild(rect(0, 0, 40, 40, "#b5b5b5"))
  pRd.appendChild(line(0, 20, 40, 20, "#9f9f9f"))
  pRd.appendChild(line(20, 0, 20, 40, "#9f9f9f"))

  const pD = pattern("patDeck", 24, 24)
  pD.appendChild(rect(0, 0, 24, 24, "#c78b45"))
  pD.appendChild(line(0, 0, 0, 24, "#a86f33", 2))
  pD.appendChild(line(12, 0, 12, 24, "#a86f33", 1))

  const pDL = pattern("patDeckLight", 24, 24)
  pDL.appendChild(rect(0, 0, 24, 24, "#e3a866"))
  pDL.appendChild(line(0, 0, 0, 24, "#c88945", 2))
  pDL.appendChild(line(12, 0, 12, 24, "#c88945", 1))

  const pB = pattern("patRestaurant", 36, 24)
  pB.appendChild(rect(0, 0, 36, 24, "#a77c7c"))
  pB.appendChild(line(0, 12, 36, 12, "#8f6666"))
  pB.appendChild(line(18, 0, 18, 12, "#8f6666"))

  const pDoor = pattern("patDoor", 18, 18)
  pDoor.appendChild(rect(0, 0, 18, 18, "#ffcc66"))
  pDoor.appendChild(line(6, 0, 6, 18, "#d9a441"))
  pDoor.appendChild(line(12, 0, 12, 18, "#d9a441"))

  svg.appendChild(defs)
}

export { addPatterns }
