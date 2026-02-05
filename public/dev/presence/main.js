// public/dev/presence/main.js
import { getDefaultUiConfig } from './config.js'
import { WsClient } from './wsClient.js'
import { PresenceUiState } from './state.js'
import { PresenceRenderer } from './renderer.js'

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

const renderSidebar = function renderSidebar({ cfg, state }) {
  const layoutInfo = byId('layoutInfo')
  const tracksTable = byId('tracksTable')
  const framesInfo = byId('framesInfo')

  const tubeR = (Number(cfg.layout.tubeDiameterMm) || 100) / 2
  layoutInfo.textContent =
    `radars: ${cfg.layout.radarAzimuthDeg.length}
azimuths: [${cfg.layout.radarAzimuthDeg.join(', ')}]
tubeDiameterMm: ${cfg.layout.tubeDiameterMm}
tubeRadiusMm: ${tubeR}
fovDeg: ${cfg.layout.radarFovDeg}
rMaxMm: ${cfg.layout.rMaxMm}
ws: ${cfg.wsPath}`

  const tracks = state.getTracks()
  const lines = tracks
    .slice(0, 30)
    .map((t) => {
      const r = Array.isArray(t.sourceRadars) ? t.sourceRadars.join(',') : ''
      return `${t.state.padEnd(9)} ${String(t.id).padEnd(18)} sp=${String(t.speedMmS).padStart(6)} seen=${String(t.lastSeenMs).padStart(4)}ms rad=[${r}]`
    })

  tracksTable.textContent = lines.length ? lines.join('\n') : '(no tracks)'

  const stats = state.getStats()
  const perRadar = [...stats.lastLd2450ByRadar.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rid, x]) => `R${rid}: det=${x.detections} ts=${x.ts} ${x.publishAs ? `(${x.publishAs})` : ''}`)
    .join('\n')

  framesInfo.textContent =
    `internalTs: ${stats.lastInternalTs ?? '-'}
rawTs:      ${stats.lastRawTs ?? '-'}
mainTs:     ${stats.lastMainTs ?? '-'}
meas: ${stats.measCount}  tracks: ${stats.trackCount}

${perRadar || ''}`
}

const main = function main() {
  const cfg = getDefaultUiConfig()

  const canvas = byId('canvas')
  const wsStatus = byId('wsStatus')
  const statLine = byId('statLine')

  const chkGrid = byId('chkGrid')
  const chkFov = byId('chkFov')
  const chkMeas = byId('chkMeas')
  const chkTracks = byId('chkTracks')
  const selScale = byId('selScale')
  const btnReconnect = byId('btnReconnect')

  const state = new PresenceUiState({ cfg })
  const renderer = new PresenceRenderer({ canvas, cfg })

  const applyControls = function applyControls() {
    cfg.draw.showGrid = Boolean(chkGrid.checked)
    cfg.draw.showFov = Boolean(chkFov.checked)
    cfg.draw.showMeasurements = Boolean(chkMeas.checked)
    cfg.draw.showTracks = Boolean(chkTracks.checked)

    const scale = Number(selScale.value)
    if (Number.isFinite(scale) && scale > 0) {
      cfg.draw.scalePxPerMm = scale
    }

    renderer.setConfig(cfg)
  }

  const tick = function tick() {
    applyControls()

    renderer.render({
      measurements: state.getMeasurements(),
      tracks: state.getTracks(),
    })

    const s = state.getStats()
    statLine.textContent = `meas=${s.measCount} tracks=${s.trackCount}`

    renderSidebar({ cfg, state })

    requestAnimationFrame(tick)
  }

  const ws = new WsClient({
    url: makeWsUrl(cfg.wsPath),
    onStatus: ({ state: st }) => setPill(wsStatus, st),
    onMessage: (msg) => {
      if (msg?.type !== 'bus.event') return
      const payload = msg.payload || {}
      const bus = String(payload.bus || '')
      const event = payload.event || null
      if (!bus || !event) return

      state.ingestBusEvent({ bus, event })
    },
  })

  btnReconnect.onclick = () => ws.connect()

  ws.connect()
  requestAnimationFrame(tick)
}

main()
