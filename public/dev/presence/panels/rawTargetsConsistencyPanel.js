// public/dev/presence/panels/rawTargetsConsistencyPanel.js

const fmt = function fmt(v, digits = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const p = Math.pow(10, digits)
  return String(Math.round(n * p) / p)
}

const sevClass = function sevClass(sev) {
  if (sev === 'ERROR') return 'bad'
  if (sev === 'WARN') return 'warn'
  return 'ok'
}

export default class RawTargetsConsistencyPanel {
  #el

  constructor({ el }) {
    this.#el = el
  }

  render({ tol, rows, stats }) {
    const list = Array.isArray(rows) ? rows : []

    const comparable = list.length
    const okCount = list.filter((r) => r.level === 'ok').length
    const warnCount = list.filter((r) => r.level === 'warn').length
    const errorCount = list.filter((r) => r.level === 'error').length
    const rawMissing = list.filter((r) => !r.hasRaw).length

    let severity = 'OK'
    if (errorCount > 0) severity = 'ERROR'
    else if (warnCount > 0 || rawMissing > 0) severity = 'WARN'

    const summary =
      `<div class="mono small">` +
      `<span class="pill ${sevClass(severity)}">${severity}</span> ` +
      `comparable=${comparable} ok=${okCount} warn=${warnCount} error=${errorCount} rawMissing=${rawMissing}` +
      `</div>`

    const tolBlock =
      `<div class="mono small">` +
      `tol: dLocal<=${tol.localMm}mm dWorld<=${tol.worldMm}mm ` +
      `Δmeas<=${tol.measAgeMs}ms Δraw<=${tol.rawMatchAgeMs}ms` +
      `</div>`

    const rollBlock =
      `<div class="mono small">` +
      `roll: dWorld med=${fmt(stats.worldMed)} max=${fmt(stats.worldMax)} ` +
      `Δmeas med=${fmt(stats.measAgeMed, 0)}ms max=${fmt(stats.measAgeMax, 0)}ms` +
      `</div>`

    const rowsBlock = list.length
      ? list.map((r) => {
        const cls = (r.level === 'error') ? 'bad' : (r.level === 'warn' ? 'warn' : 'ok')

        return (
          `<div class="mono small ${cls}">` +
          `${r.publishAs || `R${r.radarId}`}:S${r.slotId} ` +
          `dL=${fmt(r.dLocal)}mm ` +
          `dW=${fmt(r.dWorld)}mm ` +
          `Δm=${fmt(r.dtMeas, 0)}ms ` +
          `Δr=${fmt(r.dtRaw, 0)}ms ` +
          `<span class="muted">${String(r.id || '').slice(-6)}</span>` +
          `</div>`
        )
      }).join('')
      : `<div class="mono small muted">(no rows)</div>`

    this.#el.innerHTML =
      summary +
      tolBlock +
      rollBlock +
      rowsBlock
  }
}
