// public/dev/presence/panels/snapshotHealthPanel.js
const fmt = function fmt(v, digits = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const p = Math.pow(10, digits)
  return String(Math.round(n * p) / p)
}

const fmtHmsMs = function fmtHmsMs(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '-'

  const d = new Date(n)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

const badge = function badge(status) {
  const s = String(status || '')
  const cls = s === 'fresh' ? 'ok' : (s === 'stale' ? 'warn' : 'bad')
  return `<span class="pill ${cls}">${s || '-'}</span>`
}

const sevClass = function sevClass(level) {
  if (level === 'error') return 'sev-error'
  if (level === 'warn') return 'sev-warn'
  if (level === 'degraded') return 'sev-degraded'
  return 'sev-ok'
}

const rowClass = function rowClass(status) {
  const s = String(status || '')
  if (s === 'missing') return 'row-missing'
  if (s === 'stale') return 'row-stale'
  return 'row-fresh'
}

const statusLabel = function statusLabel(level) {
  if (level === 'error') return 'ERROR'
  if (level === 'warn') return 'WARN'
  if (level === 'degraded') return 'DEGRADED'
  return 'OK'
}

export default class SnapshotHealthPanel {
  #el

  constructor({ el }) {
    this.#el = el
  }

  render(health) {
    if (!health) {
      this.#el.textContent = '(no health yet)'
      return
    }

    const o = health.overall || {}
    const radars = Array.isArray(health.radars) ? health.radars : []
    const meas = health.meas || {}
    const fusion = health.fusion || null

    const tickIntervalMs = Number(o.tickIntervalMs) || 0

    const exp = Number(o.radarsExpected) || 0
    const fresh = Number(o.radarsFresh) || 0
    const stale = Number(o.radarsStale) || 0
    const missing = Number(o.radarsMissing) || 0

    const degraded = Boolean(o.degraded) || (exp > 0 && fresh < exp && stale === 0 && missing === 0)

    const tickLagP95 = Number(o.tickLagMsP95) || 0
    const lagWarn = (tickIntervalMs > 0 && tickLagP95 > (2 * tickIntervalMs))

    const level = (() => {
      if (o.stuck) return 'error'
      if (missing > 0) return 'error'
      if (stale > 0) return 'warn'
      if (lagWarn) return 'warn'
      if (degraded) return 'degraded'
      return 'ok'
    })()

    const ts = Number(health.ts)
    const seq = Number(health.seq)

    const lines = []

    // Header (quiet)
    lines.push({
      cls: 'dim',
      text: `seq ${Number.isFinite(seq) ? seq : '-'}  @ ${fmtHmsMs(ts)}`,
    })

    // One big status line (colored)
    lines.push({
      cls: `hl ${sevClass(level)}`,
      text: `${statusLabel(level)}  fresh/exp ${fmt(fresh)}/${fmt(exp)}  stale ${fmt(stale)}  missing ${fmt(missing)}  stuck ${o.stuck ? 'YES' : 'no'}`,
    })

    // Timing line (only highlight if problematic)
    const timingCls = lagWarn ? sevClass('warn') : 'sev-ok'
    lines.push({
      cls: timingCls,
      text: `maxAge ${fmt(o.maxRadarAgeMs)}ms  recvLagMax ${fmt(o.maxRecvLagMs)}ms  tickLagP95 ${fmt(o.tickLagMsP95)}ms  tickLagMax ${fmt(o.tickLagMsMax)}ms`,
    })

    // Measurement count line (quiet, but still useful)
    const fused = meas.measFused
    const fusedText = Number.isFinite(Number(fused)) ? ` fused ${fmt(fused)}` : ''
    lines.push({
      cls: 'dim',
      text: `meas in ${fmt(meas.measIn)}  filt ${fmt(meas.measFiltered)}  dedup ${fmt(meas.measDeduped)}${fusedText}  tracks ${fmt(o.activeTracks)}`,
    })

    // Radar rows (color by status only; no timestamps)
    const rows = radars
      .slice()
      .sort((a, b) => Number(a.radarId) - Number(b.radarId))
      .map((r) => {
        const detSlots = `${fmt(r.detectionCount)}/${fmt(r.slotCount)}`
        const cls = rowClass(r.status)
        const hot = String(r.status) !== 'fresh' || (Number(r.recvLagMs) < 0)

        const pub = r.publishAs ? ` ${String(r.publishAs)}` : ''
        const adv = r.advanced ? '1' : '0'

        return `<div class="${cls}${hot ? ' hl' : ''}">R${r.radarId}${pub} ${badge(r.status)} age=${fmt(r.ageMs)}ms lag=${fmt(r.recvLagMs)}ms det/slots=${detSlots} adv=${adv}</div>`
      })

    // Verbose only when non-OK (kept short)
    const verbose = []
    if (level !== 'ok') {
      verbose.push({
        cls: 'dim',
        text: `cfg tick=${fmt(o.tickIntervalMs)}ms staleMax=${fmt(o.staleMeasMaxMs)}ms missingTimeout=${fmt(o.radarMissingTimeoutMs)}ms`,
      })

      verbose.push({
        cls: 'dim',
        text: `adv ${String(o.radarsAdvancedCount ?? '-')}/${String(o.radarsExpected ?? '-')}  advancedThisTick ${o.snapshotsAdvancedThisTick ? 'true' : 'false'}  stuckTicks ${fmt(o.stuckTicks)}`,
      })

      if (fusion && typeof fusion === 'object') {
        const gate = Number(fusion.clusterGateMm)
        const gateTxt = Number.isFinite(gate) ? ` gate ${fmt(gate)}mm` : ''
        verbose.push({
          cls: 'dim',
          text: `fusion ${fusion.enabled ? 'on' : 'off'}  clusters ${fmt(fusion.clustersOut)}  multi ${fmt(fusion.clustersMultiRadar)}${gateTxt}`,
        })
      }
    }

    const linesHtml = lines.map((l) => `<div class="${l.cls}">${l.text}</div>`).join('')
    const verboseHtml = verbose.length
      ? `<div class="spacer"></div>${verbose.map((l) => `<div class="${l.cls}">${l.text}</div>`).join('')}`
      : ''

    this.#el.innerHTML =
      `<div class="mono small">${linesHtml}${verboseHtml}</div>` +
      `<div class="spacer"></div>` +
      `<div class="mono small">${rows.length ? rows.join('') : '<div class="dim">(no radar rows)</div>'}</div>`
  }
}
