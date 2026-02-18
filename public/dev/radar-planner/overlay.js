// public/dev/radar-planner/overlay.js
import { DEFAULTS } from "./scene-state.js"
import { drawWorldLayer } from "./world-layer.js"
import { drawRadarLayer } from "./radar-layer.js"
import { WORLD_OBJECTS, computeSceneBounds } from "./scene-objects.js"

const svg = document.getElementById("sceneSvg")

const ns = "http://www.w3.org/2000/svg"
const el = (tag) => document.createElementNS(ns, tag)

const get = (id) => document.getElementById(id)

const setText = (id, txt) => {
  const n = get(id)
  if (n) n.textContent = txt
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

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
  const b = computeSceneBounds(WORLD_OBJECTS)

  // Center camera on Charlie (0,0) but derive extents from scene geometry
  const sceneHalfW = Math.max(Math.abs(b.minX), Math.abs(b.maxX))
  const sceneHalfH = Math.max(Math.abs(b.minY), Math.abs(b.maxY))

  // Extra padding for radar labels/ticks beyond the circle radius
  const radarHalf = radarRadiusCm + 110

  const halfW = Math.max(sceneHalfW, radarHalf)
  const halfH = Math.max(sceneHalfH, radarHalf)

  const z = zoom
  const vb = [
    (-halfW / z),
    (-halfH / z),
    ((2 * halfW) / z),
    ((2 * halfH) / z)
  ]

  svg.setAttribute("viewBox", vb.join(" "))
}

const readState = () => {
  const afovRaw = Number(get("afovInput").value)
  const afov = Number.isFinite(afovRaw) ? clamp(afovRaw, 1, 359) : DEFAULTS.afovDeg

  const rRaw = Number(get("radarRadiusCm").value)
  const radarRadiusCm = Number.isFinite(rRaw) ? clamp(rRaw, 10, 2000) : DEFAULTS.radarRadiusCm

  const zRaw = Number(get("zoom").value)
  const zoom = Number.isFinite(zRaw) ? clamp(zRaw, 0.5, 3) : DEFAULTS.zoom

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

const render = () => {
  const state = readState()
  const { gWorld, gRadar } = ensureGroups()

  setText("zoomVal", `${state.zoom.toFixed(1)}×`)

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
}

const initDefaults = () => {
  get("radarRadiusCm").value = `${DEFAULTS.radarRadiusCm}`
  get("afovInput").value = `${DEFAULTS.afovDeg}`
  get("az0").value = `${DEFAULTS.azimuthCwDeg[0]}`
  get("az1").value = `${DEFAULTS.azimuthCwDeg[1]}`
  get("az2").value = `${DEFAULTS.azimuthCwDeg[2]}`
  get("zoom").value = `${DEFAULTS.zoom}`
  get("dimWorld").checked = DEFAULTS.dimWorld
}

initDefaults()
bind()
render()
