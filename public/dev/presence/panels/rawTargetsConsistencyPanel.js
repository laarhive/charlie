// public/dev/presence/panels/comparePanel.js
const fmt = function fmt(v, digits = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const p = Math.pow(10, digits)
  return String(Math.round(n * p) / p)
}

const cls = function cls(ok) {
  return ok ? 'ok' : 'bad'
}

export default class RawTargetsConsistencyPanel {
  #el

  constructor({ el }) {
    this.#el = el
  }

  render({ tol, rows, stats }) {
    const header =
      `Tolerances
localMm<=${tol.localMm}  worldMm<=${tol.worldMm}
measAgeMs<=${tol.measAgeMs}  rawAgeMs<=${tol.rawMatchAgeMs}

Rolling stats (last ~250 updates)
dLocal  max=${fmt(stats.localMax)}  med=${fmt(stats.localMed)}
dWorld  max=${fmt(stats.worldMax)}  med=${fmt(stats.worldMed)}
ΔtMeas  max=${fmt(stats.measAgeMax, 0)}ms  med=${fmt(stats.measAgeMed, 0)}ms
ΔtRaw   max=${fmt(stats.rawAgeMax, 0)}ms  med=${fmt(stats.rawAgeMed, 0)}ms

Per-track checks
`

    const lines = (rows || []).map((r) => {
      const parts = [
        `${r.publishAs || `R${r.radarId}`}:S${r.slotId}`,
        `dL=${fmt(r.dLocal)}mm`,
        `dW=${fmt(r.dWorld)}mm`,
        `Δm=${fmt(r.dtMeas, 0)}ms`,
        `Δr=${fmt(r.dtRaw, 0)}ms`,
        `${r.id.slice(-6)}`,
      ]

      const okAll = r.okLocal && r.okWorld && r.okMeasAge && r.okRawAge
      const c = cls(okAll)

      return `<div class="${c}">${parts.join('  ')}</div>`
    })

    this.#el.innerHTML = `<div class="mono small">${header}</div>${lines.join('') || '<div class="mono small">(no comparable tracks)</div>'}`
  }
}
