const ns = "http://www.w3.org/2000/svg"
const el = (t) => document.createElementNS(ns, t)

const worldToSvgY = (y) => -y

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

// Reduced intensity: world becomes background scene
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

const addDefs = (svg) => {
  const defs = el("defs")

  const pattern = (id, w, h) => {
    const p = el("pattern")
    p.setAttribute("id", id)
    p.setAttribute("width", w)
    p.setAttribute("height", h)
    p.setAttribute("patternUnits", "userSpaceOnUse")
    defs.appendChild(p)
    return p
  }

  const rectNode = (x, y, w, h, fill) => {
    const r = el("rect")
    r.setAttribute("x", x)
    r.setAttribute("y", y)
    r.setAttribute("width", w)
    r.setAttribute("height", h)
    r.setAttribute("fill", fill)
    return r
  }

  const circleNode = (cx, cy, r, fill) => {
    const c = el("circle")
    c.setAttribute("cx", cx)
    c.setAttribute("cy", cy)
    c.setAttribute("r", r)
    c.setAttribute("fill", fill)
    return c
  }

  const lineNode = (x1, y1, x2, y2, stroke, sw = 1) => {
    const l = el("line")
    l.setAttribute("x1", x1)
    l.setAttribute("y1", y1)
    l.setAttribute("x2", x2)
    l.setAttribute("y2", y2)
    l.setAttribute("stroke", stroke)
    l.setAttribute("stroke-width", sw)
    return l
  }

  // 🌿 Hedge (fresh green, dotted texture)
  const pH = pattern("patHedge", 16, 16)
  pH.appendChild(rectNode(0, 0, 16, 16, "#3fbf6f"))
  pH.appendChild(circleNode(4, 5, 2, "#2e9f57"))
  pH.appendChild(circleNode(12, 6, 2, "#2e9f57"))
  pH.appendChild(circleNode(8, 12, 2, "#2e9f57"))

  // 🌹 Roses (clustered flowers)
  const pR = pattern("patRoses", 18, 18)
  pR.appendChild(rectNode(0, 0, 18, 18, "#ff7aa8"))
  pR.appendChild(circleNode(6, 6, 2.2, "#ff2e63"))
  pR.appendChild(circleNode(12, 10, 2.0, "#ff2e63"))
  pR.appendChild(circleNode(9, 14, 1.8, "#ff99bb"))

  // 🚶 Sidewalk (light stone grid)
  const pS = pattern("patSidewalk", 30, 30)
  pS.appendChild(rectNode(0, 0, 30, 30, "#d9d9d9"))
  pS.appendChild(lineNode(0, 0, 30, 0, "#bfbfbf"))
  pS.appendChild(lineNode(0, 15, 30, 15, "#cfcfcf"))
  pS.appendChild(lineNode(0, 0, 0, 30, "#bfbfbf"))
  pS.appendChild(lineNode(15, 0, 15, 30, "#cfcfcf"))

  // 🛣 Road (darker stone blocks)
  const pRd = pattern("patRoad", 40, 40)
  pRd.appendChild(rectNode(0, 0, 40, 40, "#b5b5b5"))
  pRd.appendChild(lineNode(0, 20, 40, 20, "#9f9f9f"))
  pRd.appendChild(lineNode(20, 0, 20, 40, "#9f9f9f"))

  // 🪵 Terrace (warm wood planks)
  const pD = pattern("patDeck", 24, 24)
  pD.appendChild(rectNode(0, 0, 24, 24, "#c78b45"))
  pD.appendChild(lineNode(0, 0, 0, 24, "#a86f33", 2))
  pD.appendChild(lineNode(12, 0, 12, 24, "#a86f33", 1))

  // Walkway (lighter wood planks)
  const pDL = pattern("patDeckLight", 24, 24)
  pDL.appendChild(rectNode(0, 0, 24, 24, "#e3a866"))
  pDL.appendChild(lineNode(0, 0, 0, 24, "#c88945", 2))
  pDL.appendChild(lineNode(12, 0, 12, 24, "#c88945", 1))

  // 🧱 Restaurant wall (brick hint)
  const pB = pattern("patRestaurant", 36, 24)
  pB.appendChild(rectNode(0, 0, 36, 24, "#a77c7c"))
  pB.appendChild(lineNode(0, 12, 36, 12, "#8f6666"))
  pB.appendChild(lineNode(18, 0, 18, 12, "#8f6666"))

  // 🚪 Door (golden wood with panels)
  const pDoor = pattern("patDoor", 18, 18)
  pDoor.appendChild(rectNode(0, 0, 18, 18, "#ffcc66"))
  pDoor.appendChild(lineNode(6, 0, 6, 18, "#d9a441"))
  pDoor.appendChild(lineNode(12, 0, 12, 18, "#d9a441"))

  svg.appendChild(defs)
}


const rect = (group, x1, y1, x2, y2, cls, label) => {
  const r = el("rect")
  r.setAttribute("x", x1)
  r.setAttribute("y", worldToSvgY(y2))
  r.setAttribute("width", x2 - x1)
  r.setAttribute("height", y2 - y1)
  r.setAttribute("fill", FILL[cls])
  r.setAttribute("opacity", `${OPACITY[cls]}`)
  group.appendChild(r)

  if (label) {
    const t = el("text")
    t.setAttribute("x", (x1 + x2) / 2)
    t.setAttribute("y", worldToSvgY((y1 + y2) / 2))
    t.setAttribute("text-anchor", "middle")
    t.setAttribute("dominant-baseline", "middle")
    t.setAttribute("fill", "rgba(255,255,255,0.55)")
    t.setAttribute("font-size", "13")
    t.setAttribute("font-weight", "400")
    t.textContent = label
    group.appendChild(t)
  }
}

const addLabel = (group, x, y, text) => {
  const t = el("text")
  t.setAttribute("x", x)
  t.setAttribute("y", worldToSvgY(y))
  t.setAttribute("text-anchor", "middle")
  t.setAttribute("dominant-baseline", "middle")
  t.setAttribute("fill", "rgba(255,255,255,0.55)")
  t.setAttribute("font-size", "13")
  t.setAttribute("font-weight", "400")
  t.textContent = text
  group.appendChild(t)
}

const charlieHalfCircle = (group) => {
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
  path.setAttribute("fill", "rgba(0,220,255,0.35)")
  path.setAttribute("stroke", "rgba(255,255,255,0.55)")
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
}

const drawWorldLayer = ({ svg, group, dim }) => {
  if (!svg.querySelector("defs")) addDefs(svg)

  group.innerHTML = ""
  if (dim) {
    group.setAttribute("opacity", "0.80")
    group.style.filter = "saturate(0.75) brightness(1.05)"
  } else {
    group.setAttribute("opacity", "1")
    group.style.filter = "none"
  }

  charlieHalfCircle(group)

  rect(group, -30, -610, 30, -30, "hedge", "Hedge")
  rect(group, -30, 210, 30, 600, "hedge")

  rect(group, 30, -610, 60, -30, "roses", "Roses")
  rect(group, 30, 210, 60, 600, "roses")

  rect(group, 60, -700, 270, 800, "sidewalk")
  rect(group, 270, -700, 600, 800, "road")

  addLabel(group, 165, 600, "Sidewalk")
  addLabel(group, 435, 600, "Pedestrian Road")

  rect(group, -530, -610, -30, -30, "terrace", "Terrace")
  rect(group, -530, 210, -30, 600, "terrace")

  rect(group, -530, -30, 60, 210, "walkway", "Walkway")
  rect(group, -580, -610, -530, 600, "restaurant", "Restaurant")
  rect(group, -550, -30, -530, 110, "door", "Door")
}

export { drawWorldLayer }
