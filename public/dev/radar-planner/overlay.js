import { drawWorldLayer } from "./world-layer.js"
import { drawRadarLayer } from "./radar-layer.js"

const svg = document.getElementById("sceneSvg")

const ns = "http://www.w3.org/2000/svg"
const el = (tag) => document.createElementNS(ns, tag)

const get = (id) => document.getElementById(id)

const setText = (id, txt) => {
  const n = get(id)
  if (n) n.textContent = txt
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const read = () => {
  const afovRaw = Number(get("afovInput").value)
  const afov = Number.isFinite(afovRaw) ? clamp(afovRaw, 1, 359) : 120

  const rRaw = Number(get("radarRadiusCm").value)
  const radarRadiusCm = Number.isFinite(rRaw) ? clamp(rRaw, 10, 2000) : 200

  const zRaw = Number(get("zoom").value)
  const zoom = Number.isFinite(zRaw) ? clamp(zRaw, 0.5, 3) : 1

  const az0 = Number(get("az0").value)
  const az1 = Number(get("az1").value)
  const az2 = Number(get("az2").value)

  return {
    afov,
    radarRadiusCm,
    zoom,
    azimuth: [az0, az1, az2],
    showWorld: get("showWorld").checked,
    showRadar: get("showRadar").checked,
    showOverlap2: get("showOverlap2").checked,
    showOverlap3: get("showOverlap3").checked,
    showTicks: get("showTicks").checked,
    showAfovRadials: get("showAfovRadials").checked,
    dimWorld: get("dimWorld").checked
  }
}

const ensureGroups = () => {
  let gWorld = svg.querySelector("#gWorld")
  let gRadar = svg.querySelector("#gRadar")

  if (!gWorld) {
    gWorld = el("g")
    gWorld.setAttribute("id", "gWorld")
    svg.appendChild(gWorld)
  }

  if (!gRadar) {
    gRadar = el("g")
    gRadar.setAttribute("id", "gRadar")
    svg.appendChild(gRadar)
  }

  return { gWorld, gRadar }
}

const setCamera = ({ radarRadiusCm, zoom }) => {
  // World extents (from your layout)
  // X: -580..600, Y: -700..800 (in world coords)
  const worldHalfW = 650
  const worldHalfH = 850

  // Ensure radar fits too (extra room for labels/ticks)
  const radarHalf = radarRadiusCm + 90

  const halfW = Math.max(worldHalfW, radarHalf)
  const halfH = Math.max(worldHalfH, radarHalf)

  const z = zoom
  const vb = [
    (-halfW / z),
    (-halfH / z),
    ((2 * halfW) / z),
    ((2 * halfH) / z)
  ]

  svg.setAttribute("viewBox", vb.join(" "))
}

const render = () => {
  const state = read()
  const { gWorld, gRadar } = ensureGroups()

  setText("zoomVal", `${state.zoom.toFixed(1)}×`)

  // Camera first so radius changes are visible
  setCamera({ radarRadiusCm: state.radarRadiusCm, zoom: state.zoom })

  gWorld.style.display = state.showWorld ? "" : "none"
  gRadar.style.display = state.showRadar ? "" : "none"

  if (state.showWorld) {
    drawWorldLayer({
      svg,
      group: gWorld,
      dim: state.dimWorld && state.showRadar
    })
  }

  if (state.showRadar) {
    drawRadarLayer({
      group: gRadar,
      azimuthCwDeg: state.azimuth,
      fovDeg: 120,
      afovDeg: state.afov,
      radarRadiusCm: state.radarRadiusCm,
      showOverlap2: state.showOverlap2,
      showOverlap3: state.showOverlap3,
      showTicks: state.showTicks,
      showAfovRadials: state.showAfovRadials,
      onStats: ({ ov2, ov3 }) => {
        setText("overlap2Val", `${ov2}°`)
        setText("overlap3Val", `${ov3}°`)
      }
    })
  } else {
    setText("overlap2Val", "")
    setText("overlap3Val", "")
  }
}

const bind = () => {
  const ids = [
    "radarRadiusCm",
    "zoom",
    "afovInput",
    "az0",
    "az1",
    "az2",
    "showWorld",
    "showRadar",
    "showOverlap2",
    "showOverlap3",
    "showTicks",
    "showAfovRadials",
    "dimWorld"
  ]

  ids.forEach((id) => {
    const n = get(id)
    if (!n) return
    n.addEventListener("input", render)
    n.addEventListener("change", render)
  })

  render()
}

bind()
