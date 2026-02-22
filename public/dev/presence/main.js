// public/dev/presence/main.js
import { WsClient } from './wsClient.js'
import { PresenceUiState } from './state.js'
import { PresenceRenderer } from './renderer.js'
import { loadUiConfig } from './config.js'
import Ld2450RawTargetsConsistencyMonitor from './monitor/ld2450RawTargetsConsistencyMonitor.js'
import RawTargetsConsistencyPanel from './panels/rawTargetsConsistencyPanel.js'
import SnapshotHealthPanel from './panels/snapshotHealthPanel.js'
import SnapshotSanityPanel from './panels/snapshotSanityPanel.js'

const byId = function byId(id) {
  return document.getElementById(id)
}

const makeWsUrl = function makeWsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

const setPill = function setPill(el, state) {
  el.classList.remove('ok', 'bad')

  if (state === 'open') {
    el.textContent = 'connected'
    el.classList.add('ok')
    return
  }

  if (state === 'connecting') {
    el.textContent = 'connecting'
    return
  }

  el.textContent = state
  el.classList.add('bad')
}

const formatHmsMs = function formatHmsMs(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n)) return '-'

  const d = new Date(n)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

const ldName = function ldName(radarId) {
  const i = Number(radarId)
  if (!Number.isFinite(i) || i < 0 || i > 2) return null

  const letter = String.fromCharCode('A'.charCodeAt(0) + i)
  return `LD2450${letter}`
}

const fmtM = function fmtM(mm) {
  const n = Number(mm)
  if (!Number.isFinite(n)) return '-'
  return (n / 1000).toFixed(2)
}

const renderSidebar = function renderSidebar({ cfg, state }) {
  const layoutInfo = byId('layoutInfo')
  const tracksTable = byId('tracksTable')
  const targetsInfo = byId('targetsInfo')

  const tubeR = (Number(cfg.layout.tubeDiameterMm) || 100) / 2
  layoutInfo.textContent =
    `radars: ${cfg.layout.radarAzimuthDeg.length}
azimuths: [${cfg.layout.radarAzimuthDeg.join(', ')}]
tubeDiameterMm: ${cfg.layout.tubeDiameterMm}
tubeRadiusMm: ${tubeR}
fovDeg: ${cfg.layout.radarFovDeg}
rMaxMm: ${cfg.draw.rMaxMm}`

  const stats = state.getStats()

  // Targets panel: only LD2450A/B/C, show ts + per-target dist
  const radarLines = []
  const perRadar = [...stats.lastLd2450ByRadar.entries()]
    .sort((a, b) => a[0] - b[0])

  for (const [rid, x] of perRadar) {
    const name = ldName(rid)
    if (!name) continue

    radarLines.push(`${name} ts=${x.ts} valid=${x.validCount}`)

    const targets = Array.isArray(x.targets) ? x.targets : []
    for (const t of targets.slice(0, 3)) {
      radarLines.push(`  T${t.localId} dist=${fmtM(t.distMm)}m`)
    }
  }

  targetsInfo.textContent = radarLines.length ? radarLines.join('\n') : '(no LD2450 frames yet)'

  // Tracks panel: header + list
  const tracks = state.getTracks()
  const mainHms = formatHmsMs(stats.lastMainTs)

  const header =
    `rawTs:  ${stats.lastRawTs ?? '-'}
mainTs: ${stats.lastMainTs ?? '-'}  (${mainHms})
tracks: ${stats.trackCount}

`

  const lines = tracks
    .slice(0, 30)
    .map((t) => {
      const r = Array.isArray(t.sourceRadars) ? t.sourceRadars.join(',') : ''
      return `${t.state.padEnd(9)} ${String(t.id).padEnd(18)} sp=${String(t.speedMmS).padStart(6)} seen=${String(t.lastSeenMs).padStart(4)}ms rad=[${r}]`
    })

  tracksTable.textContent = header + (lines.length ? lines.join('\n') : '(no tracks)')
}

const radarIdFromPublishAs = function radarIdFromPublishAs(cfgPresence, publishAs) {
  const s = String(publishAs || '').trim()
  const list = Array.isArray(cfgPresence?.layout?.ld2450) ? cfgPresence.layout.ld2450 : []
  const idx = list.findIndex((x) => String(x?.publishAs || '').trim() === s)
  return idx >= 0 ? idx : null
}

const main = async function main() {
  const cfgUi = await loadUiConfig()
  const cfgPresence = cfgUi.presence

  const canvas = byId('canvas')
  const wsStatus = byId('wsStatus')
  const statLine = byId('statLine')

  const chkGrid = byId('chkGrid')
  const chkFov = byId('chkFov')
  const chkRaw = byId('chkRaw')
  const chkTracks = byId('chkTracks')

  const inpRangeM = byId('inpRangeM')
  const inpRawTrailS = byId('inpRawTrailS')
  const inpTrackTrailS = byId('inpTrackTrailS')

  const btnFreeze = byId('btnFreeze')
  const tglConnect = byId('tglConnect')
  const btnClearTrails = byId('btnClearTrails')

  const state = new PresenceUiState({ cfg: cfgPresence })
  const renderer = new PresenceRenderer({ canvas, cfg: cfgPresence })

  const rawTargetsPanel = new RawTargetsConsistencyPanel({ el: byId('rawTargetsConsistencyInfo') })
  const rawTargetsMonitor = new Ld2450RawTargetsConsistencyMonitor({
    cfg: cfgPresence,
    tol: {
      localMm: 5,
      worldMm: 15,
      measAgeMs: 250,
      rawMatchAgeMs: 200,
    },
  })

  const snapshotHealthPanel = new SnapshotHealthPanel({ el: byId('snapshotHealthInfo') })
  const snapshotSanityPanel = new SnapshotSanityPanel({ el: byId('snapshotSanityInfo') })

  let frozen = false
  let settingToggle = false

  const setFreezeUi = function setFreezeUi() {
    btnFreeze.textContent = frozen ? 'Resume' : 'Freeze'
  }

  const applyControls = function applyControls() {
    cfgPresence.draw.showGrid = Boolean(chkGrid.checked)
    cfgPresence.draw.showFov = Boolean(chkFov.checked)
    cfgPresence.draw.showMeasurements = Boolean(chkRaw.checked)
    cfgPresence.draw.showTracks = Boolean(chkTracks.checked)

    const rawTrailS = Number(inpRawTrailS.value)
    cfgPresence.draw.rawTrailKeepS = Number.isFinite(rawTrailS) ? rawTrailS : 0

    const trackTrailS = Number(inpTrackTrailS.value)
    cfgPresence.draw.trackTrailKeepS = Number.isFinite(trackTrailS) ? trackTrailS : 0

    const rangeM = Number(inpRangeM.value)
    if (Number.isFinite(rangeM) && rangeM > 0) {
      const rMaxMm = rangeM * 1000
      cfgPresence.draw.rMaxMm = rMaxMm

      const marginPx = 40
      const rMaxPx = Math.max(120, (Math.min(canvas.width, canvas.height) / 2) - marginPx)

      cfgPresence.draw.scalePxPerMm = rMaxPx / rMaxMm
    }

    renderer.setConfig(cfgPresence)
    state.setConfig(cfgPresence)
  }

  const ws = new WsClient({
    url: makeWsUrl(cfgUi.wsPath),
    onStatus: ({ state: st }) => {
      setPill(wsStatus, st)

      const isOpen = st === 'open'
      if (!settingToggle) {
        settingToggle = true
        tglConnect.checked = isOpen
        settingToggle = false
      }
    },
    onMessage: (msg) => {
      if (msg?.type !== 'bus.event') return
      const payload = msg.payload || {}
      const bus = String(payload.bus || '')
      const event = payload.event || null
      if (!bus || !event) return

      state.ingestBusEvent({ bus, event })

      // raw bus -> monitor raw store
      if (bus === 'presence' && event.type === 'presenceRaw:ld2450') {
        const p = event.payload || {}
        rawTargetsMonitor.ingestRawLd2450({
          publishAs: p.publishAs,
          radarId: radarIdFromPublishAs(cfgPresence, p.publishAs),
          frame: p.frame,
          tsNow: Number(event.ts) || Date.now(),
        })
      }

      // presenceInternal bus -> snapshot health
      if (bus === 'presenceInternal' && event.type === 'presence:trackingSnapshotHealth') {
        state.ingestTrackingSnapshotHealth(event.payload || null)
      }

      // main bus -> monitor compare rows
      if (bus === 'main' && event.type === 'presence:targets') {
        const targets = Array.isArray(event?.payload?.targets) ? event.payload.targets : []
        rawTargetsMonitor.ingestMainTargets({
          tsMain: Number(event.ts) || Date.now(),
          targets,
        })
      }
    },
  })

  btnFreeze.onclick = () => {
    frozen = !frozen
    setFreezeUi()
  }

  btnClearTrails.onclick = () => {
    state.clearPlotData()

    renderer.render({
      measurements: state.getMeasurements(),
      tracks: state.getTracks(),
      rawTrails: state.getRawTrails(),
      trackTrails: state.getTrackTrails(),
    })

    const s = state.getStats()
    statLine.textContent = `raw=${s.measCount} tracks=${s.trackCount}`
    renderSidebar({ cfg: cfgPresence, state })
  }

  tglConnect.onchange = () => {
    if (settingToggle) return

    if (tglConnect.checked) {
      ws.connect()
      return
    }

    ws.close()
  }

  const initialRangeM = (Number(cfgPresence?.draw?.rMaxMm) || 3000) / 1000
  inpRangeM.value = String(Math.round(initialRangeM * 10) / 10)

  if (!Number.isFinite(Number(cfgPresence?.draw?.rawTrailKeepS))) {
    cfgPresence.draw.rawTrailKeepS = 1.5
  }
  if (!Number.isFinite(Number(cfgPresence?.draw?.trackTrailKeepS))) {
    cfgPresence.draw.trackTrailKeepS = 4.0
  }

  inpRawTrailS.value = String(cfgPresence.draw.rawTrailKeepS)
  inpTrackTrailS.value = String(cfgPresence.draw.trackTrailKeepS)

  setFreezeUi()

  const tick = function tick() {
    applyControls()

    if (!frozen) {
      renderer.render({
        measurements: state.getMeasurements(),
        tracks: state.getTracks(),
        rawTrails: state.getRawTrails(),
        trackTrails: state.getTrackTrails(),
      })

      rawTargetsPanel.render(rawTargetsMonitor.snapshot())
      snapshotHealthPanel.render(state.getTrackingSnapshotHealth())
      snapshotSanityPanel.render(state.getTrackingSnapshotHealth())

      const s = state.getStats()
      statLine.textContent = `raw=${s.measCount} tracks=${s.trackCount}`

      renderSidebar({ cfg: cfgPresence, state })
    }

    requestAnimationFrame(tick)
  }

  ws.connect()
  requestAnimationFrame(tick)
}

main()
