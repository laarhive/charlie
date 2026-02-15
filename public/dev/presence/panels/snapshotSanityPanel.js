// public/dev/presence/panels/snapshotSanityPanel.js
const fmt = function fmt(v, digits = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const p = Math.pow(10, digits)
  return String(Math.round(n * p) / p)
}

const itemLine = function itemLine({ level, code, count, details }) {
  const cls = level === 'error' ? 'sev-error' : (level === 'warn' ? 'sev-warn' : 'sev-degraded')
  const cnt = Number.isFinite(Number(count)) ? ` x${count}` : ''
  const det = details ? `  ${JSON.stringify(details)}` : ''
  return `<div class="${cls}">${code}${cnt}${det}</div>`
}

export default class SnapshotSanityPanel {
  #el

  constructor({ el }) {
    this.#el = el
  }

  render(health) {
    const sanity = health?.sanity || null
    if (!sanity) {
      this.#el.textContent = '(no sanity yet)'
      return
    }

    const errors = Array.isArray(sanity.error) ? sanity.error : []
    const warns = Array.isArray(sanity.warn) ? sanity.warn : []
    const degraded = Array.isArray(sanity.degraded) ? sanity.degraded : []

    const any = errors.length || warns.length || degraded.length

    if (!any) {
      this.#el.innerHTML = `<div class="mono small dim">(no issues)</div>`
      return
    }

    const head = `<div class="mono small dim">issues: err=${fmt(errors.length)} warn=${fmt(warns.length)} deg=${fmt(degraded.length)}</div>`

    const out = []
    for (const e of errors) out.push(itemLine({ level: 'error', code: e.code, count: e.count, details: e.details || e.last || null }))
    for (const w of warns) out.push(itemLine({ level: 'warn', code: w.code, count: w.count, details: w.details || w.last || null }))
    for (const d of degraded) out.push(itemLine({ level: 'degraded', code: d.code, count: d.count, details: d.details || null }))

    this.#el.innerHTML = `${head}<div class="mono small">${out.join('')}</div>`
  }
}
