// public/dev/radar-planner/overlay.js
import { DEFAULTS } from "./scene-state.js"
import { drawGridLayer } from "./grid-layer.js"
import { drawWorldLayer } from "./world-layer.js"
import { drawEngagementLayer } from "./engagement-layer.js"
import { drawRadarLayer } from "./radar-layer.js"
import { drawCompassHUD } from "./compass-hud.js"
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

const normalizeDeg = function normalizeDeg(deg) {
  let a = Number(deg)
  if (!Number.isFinite(a)) a = 0
  a = a % 360
  if (a < 0) a += 360
  return a
}

let prevCharlieFacingDeg = null

const ensureGroups = () => {
  let gGrid = svg.querySelector("#gGrid")
  let gWorld = svg.querySelector("#gWorld")
  let gEngagement = svg.querySelector("#gEngagement")
  let gRadar = svg.querySelector("#gRadar")
  let gHud = svg.querySelector("#gHud")

  if (!gGrid) {
    gGrid = el("g")
    gGrid.setAttribute("id", "gGrid")
    svg.appendChild(gGrid)
  }

  if (!gWorld) {
    gWorld = el("g")
    gWorld.setAttribute("id", "gWorld")
    svg.appendChild(gWorld)
  }

  if (!gEngagement) {
    gEngagement = el("g")
    gEngagement.setAttribute("id", "gEngagement")
    svg.appendChild(gEngagement)
  }

  if (!gRadar) {
    gRadar = el("g")
    gRadar.setAttribute("id", "gRadar")
    svg.appendChild(gRadar)
  }

  if (!gHud) {
    gHud = el("g")
    gHud.setAttribute("id", "gHud")
    svg.appendChild(gHud)
  }

  return { gGrid, gWorld, gEngagement, gRadar, gHud }
}

const setCamera = ({ radarRadiusCm, zoom }) => {
  const b = computeSceneBounds(WORLD_OBJECTS)

  const sceneHalfW = Math.max(Math.abs(b.minX), Math.abs(b.maxX))
  const sceneHalfH = Math.max(Math.abs(b.minY), Math.abs(b.maxY))

  const radarHalf = radarRadiusCm + 140

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

  return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
}

const readState = () => {
  const afovRaw = Number(get("afovInput").value)
  const afov = Number.isFinite(afovRaw) ? clamp(afovRaw, 1, 120) : DEFAULTS.afovDeg

  const rRaw = Number(get("radarRadiusCm").value)
  const radarRadiusCm = Number.isFinite(rRaw) ? clamp(rRaw, 10, 2000) : DEFAULTS.radarRadiusCm

  const zRaw = Number(get("zoom").value)
  const zoom = Number.isFinite(zRaw) ? clamp(zRaw, 0.5, 3) : DEFAULTS.zoom

  const charlieFacingRaw = Number(get("charlieFacingDeg").value)
  const charlieFacingDeg = Number.isFinite(charlieFacingRaw) ? charlieFacingRaw : DEFAULTS.charlieFacingDeg

  const az0Raw = Number(get("az0").value)
  const az1Raw = Number(get("az1").value)
  const az2Raw = Number(get("az2").value)

  return {
    afov,
    radarRadiusCm,
    zoom,

    charlieFacingRaw: charlieFacingDeg,
    charlieFacingNorm: normalizeDeg(charlieFacingDeg),

    azRaw: [az0Raw, az1Raw, az2Raw],
    azNorm: [normalizeDeg(az0Raw), normalizeDeg(az1Raw), normalizeDeg(az2Raw)],

    showGrid: get("showGrid").checked,
    showWorld: get("showWorld").checked,
    showEngagement: get("showEngagement").checked,
    showRadar: get("showRadar").checked,

    showTicks: get("showTicks").checked,
    dimWorld: get("dimWorld").checked,

    mountRadarsToCharlie: get("mountRadarsToCharlie").checked
  }
}

const normalizeFieldIfNotActive = (id, valueNorm) => {
  const n = get(id)
  if (!n) return
  if (document.activeElement === n) return
  n.value = `${valueNorm}`
}

const syncRigYawField = (state) => {
  const rigYawEl = get("rigYaw")
  if (!rigYawEl) return
  if (document.activeElement === rigYawEl) return

  const yaw = normalizeDeg(state.azNorm[0] - state.charlieFacingNorm)
  rigYawEl.value = `${yaw}`
}

const render = () => {
  const state = readState()

  normalizeFieldIfNotActive("charlieFacingDeg", state.charlieFacingNorm)
  normalizeFieldIfNotActive("az0", state.azNorm[0])
  normalizeFieldIfNotActive("az1", state.azNorm[1])
  normalizeFieldIfNotActive("az2", state.azNorm[2])
  normalizeFieldIfNotActive("afovInput", state.afov)

  setText("zoomVal", `${state.zoom.toFixed(1)}×`)

  // Bearing CW from TRUE North:
  // bearing = facing - trueNorth (both expressed in planner CW-from-up)
  const bearingFromTrueN = normalizeDeg(state.charlieFacingNorm - DEFAULTS.trueNorthCwDeg)
  setText("charlieBearingVal", `${bearingFromTrueN}°`)

  const vb = setCamera({ radarRadiusCm: state.radarRadiusCm, zoom: state.zoom })
  const { gGrid, gWorld, gEngagement, gRadar, gHud } = ensureGroups()

  gGrid.style.display = state.showGrid ? "" : "none"
  gWorld.style.display = state.showWorld ? "" : "none"
  gEngagement.style.display = state.showEngagement ? "" : "none"
  gRadar.style.display = state.showRadar ? "" : "none"
  gHud.style.display = ""

  drawGridLayer({
    group: gGrid,
    show: state.showGrid,
    viewBox: vb,
    stepCm: 50,
    boldEveryCm: 100
  })

  if (state.showWorld) {
    drawWorldLayer({
      svg,
      group: gWorld,
      dim: state.dimWorld && state.showRadar
    })
  } else {
    gWorld.innerHTML = ""
  }

  drawEngagementLayer({
    group: gEngagement,
    show: state.showEngagement,
    charlieFacingDeg: state.charlieFacingNorm
  })

  if (state.showRadar) {
    drawRadarLayer({
      group: gRadar,
      azimuthCwDeg: state.azNorm,
      fovDeg: 120,
      afovDeg: state.afov,
      radarRadiusCm: state.radarRadiusCm,
      showTicks: state.showTicks,
      tubeRadiusCm: DEFAULTS.tubeRadiusCm,
      onPairOverlap: ({ ov01, ov12, ov20 }) => {
        setText("overlap01Val", `${ov01}°`)
        setText("overlap12Val", `${ov12}°`)
        setText("overlap20Val", `${ov20}°`)
      }
    })
  } else {
    setText("overlap01Val", "")
    setText("overlap12Val", "")
    setText("overlap20Val", "")
    gRadar.innerHTML = ""
  }

  drawCompassHUD({ group: gHud, viewBox: vb })

  syncRigYawField(state)
}

const bindWrapField = function bindWrapField(id, step = 1) {
  const n = get(id)
  if (!n) return

  let lastValue = Number(n.value)

  const applyWrapFromDelta = (nextRaw) => {
    const prev = Number.isFinite(lastValue) ? lastValue : Number(n.value)
    const next = Number(nextRaw)

    if (!Number.isFinite(next) || !Number.isFinite(prev)) {
      lastValue = next
      return
    }

    // Native spinner often does prev+1 or prev-1, detect boundary crossing
    if (prev === 359 && next === 360) {
      n.value = "0"
      lastValue = 0
      return
    }

    if (prev === 0 && next === -1) {
      n.value = "359"
      lastValue = 359
      return
    }

    lastValue = next
  }

  n.addEventListener("input", () => {
    applyWrapFromDelta(n.value)
    render()
  })

  n.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()

    const cur = Number(n.value)
    const curNorm = normalizeDeg(cur)

    const next = e.key === "ArrowUp"
      ? normalizeDeg(curNorm + step)
      : normalizeDeg(curNorm - step)

    n.value = `${next}`
    lastValue = next
    render()
  })

  n.addEventListener("wheel", (e) => {
    if (document.activeElement !== n) return
    e.preventDefault()

    const cur = Number(n.value)
    const curNorm = normalizeDeg(cur)

    const next = e.deltaY < 0
      ? normalizeDeg(curNorm + step)
      : normalizeDeg(curNorm - step)

    n.value = `${next}`
    lastValue = next
    render()
  }, { passive: false })
}

const bind = () => {
  const facingEl = get("charlieFacingDeg")
  const mountEl = get("mountRadarsToCharlie")

  if (facingEl) {
    facingEl.addEventListener("input", () => {
      const next = Number(facingEl.value)
      if (!Number.isFinite(next)) {
        render()
        return
      }

      const nextNorm = normalizeDeg(next)

      if (prevCharlieFacingDeg === null) prevCharlieFacingDeg = nextNorm

      let delta = nextNorm - prevCharlieFacingDeg
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360

      prevCharlieFacingDeg = nextNorm

      if (mountEl?.checked) {
        ;["az0", "az1", "az2"].forEach((id) => {
          const n = get(id)
          if (!n) return
          const cur = Number(n.value)
          const curNorm = normalizeDeg(cur)
          n.value = `${curNorm + delta}`
        })
      }

      render()
    })
  }

  if (mountEl) {
    mountEl.addEventListener("change", () => {
      prevCharlieFacingDeg = normalizeDeg(get("charlieFacingDeg")?.value)
      render()
    })
  }

  const rigYawEl = get("rigYaw")
  if (rigYawEl) {
    rigYawEl.addEventListener("input", () => {
      const yawRaw = Number(rigYawEl.value)
      if (!Number.isFinite(yawRaw)) {
        render()
        return
      }

      const yaw = normalizeDeg(yawRaw)
      const facing = normalizeDeg(get("charlieFacingDeg")?.value)

      const az0El = get("az0")
      const az1El = get("az1")
      const az2El = get("az2")
      if (!az0El || !az1El || !az2El) return

      const curAz0 = normalizeDeg(az0El.value)
      const desiredAz0 = normalizeDeg(facing + yaw)

      let delta = desiredAz0 - curAz0
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360

      ;[az0El, az1El, az2El].forEach((n) => {
        const curNorm = normalizeDeg(n.value)
        n.value = `${curNorm + delta}`
      })

      render()
    })
  }

  // Wrap-enabled fields
  bindWrapField("charlieFacingDeg", 1)
  bindWrapField("rigYaw", 1)
  bindWrapField("az0", 1)
  bindWrapField("az1", 1)
  bindWrapField("az2", 1)

  const ids = [
    "radarRadiusCm",
    "zoom",
    "afovInput",
    "showGrid",
    "showWorld",
    "showEngagement",
    "showRadar",
    "showTicks",
    "dimWorld"
  ]

  ids.forEach((id) => {
    const n = get(id)
    if (!n) return
    n.addEventListener("input", render)
    n.addEventListener("change", render)
    n.addEventListener("blur", render)
  })
}

const initDefaults = () => {
  get("radarRadiusCm").value = `${DEFAULTS.radarRadiusCm}`
  get("afovInput").value = `${clamp(DEFAULTS.afovDeg, 1, 120)}`

  get("az0").value = `${DEFAULTS.azimuthCwDeg[0]}`
  get("az1").value = `${DEFAULTS.azimuthCwDeg[1]}`
  get("az2").value = `${DEFAULTS.azimuthCwDeg[2]}`

  get("zoom").value = `${DEFAULTS.zoom}`

  get("dimWorld").checked = DEFAULTS.dimWorld
  get("showGrid").checked = DEFAULTS.showGrid
  get("showTicks").checked = DEFAULTS.showTicks

  get("showEngagement").checked = DEFAULTS.showEngagement
  get("charlieFacingDeg").value = `${DEFAULTS.charlieFacingDeg}`

  get("mountRadarsToCharlie").checked = DEFAULTS.mountRadarsToCharlie

  prevCharlieFacingDeg = normalizeDeg(get("charlieFacingDeg").value)

  get("rigYaw").value = `${normalizeDeg(normalizeDeg(get("az0").value) - prevCharlieFacingDeg)}`
}

initDefaults()
bind()
render()
