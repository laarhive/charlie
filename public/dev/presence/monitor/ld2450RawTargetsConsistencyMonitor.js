// public/dev/radar/monitor/ld2450RawTargetsConsistencyMonitor.js
import TransformService from '../transform.js'
import StatsWindow from '../utils/statsWindow.js'

const distMm = function distMm(a, b) {
  const dx = Number(a.xMm) - Number(b.xMm)
  const dy = Number(a.yMm) - Number(b.yMm)
  if (![dx, dy].every(Number.isFinite)) return null
  return Math.sqrt((dx * dx) + (dy * dy))
}

const keyOf = function keyOf(radarId, slotId) {
  return `${radarId}:${slotId}`
}

const maxLevel = function maxLevel(levels) {
  const order = { ok: 0, warn: 1, error: 2 }
  let best = 'ok'
  for (const l of levels) {
    if ((order[l] ?? 0) > (order[best] ?? 0)) best = l
  }
  return best
}

export default class Ld2450RawTargetsConsistencyMonitor {
  #cfg
  #xform

  #tol

  // latest raw by radar/slot
  #rawLatestByKey = new Map() // key -> { ts, publishAs, radarId, slotId, localMm:{x,y}, worldMm:{x,y} }

  // rolling stats (last N track updates)
  #wLocal = new StatsWindow({ maxN: 250 })
  #wWorld = new StatsWindow({ maxN: 250 })
  #wMeasAge = new StatsWindow({ maxN: 250 })
  #wRawAge = new StatsWindow({ maxN: 250 })

  // last computed rows for panel
  #rows = []

  // aggregate counts for UI
  #summary = {
    tsMain: null,
    comparable: 0,
    ok: 0,
    warn: 0,
    error: 0,
    missingRaw: 0,
  }

  constructor({ cfg, tol }) {
    this.#cfg = cfg
    this.#xform = new TransformService({ layout: cfg.layout })

    this.#tol = {
      localMm: 5,
      worldMm: 15,
      measAgeMs: 250,
      rawMatchAgeMs: 150,
      ...(tol || {}),
    }
  }

  tolerances() {
    return { ...this.#tol }
  }

  ingestRawLd2450({ publishAs, radarId, frame, tsNow }) {
    const rid = Number(radarId)
    if (!Number.isFinite(rid)) return

    const now = Number(tsNow) || Date.now()

    const targets = Array.isArray(frame?.targets) ? frame.targets : []
    for (const t of targets) {
      if (!t || t.valid !== true) continue

      const slotId = Number(t.id)
      if (!Number.isFinite(slotId)) continue

      const local = { xMm: Number(t.xMm), yMm: Number(t.yMm) }
      if (![local.xMm, local.yMm].every(Number.isFinite)) continue

      const world = this.#xform.toWorldMm({ radarId: rid, xMm: local.xMm, yMm: local.yMm })

      this.#rawLatestByKey.set(keyOf(rid, slotId), {
        ts: now,
        publishAs: String(publishAs || ''),
        radarId: rid,
        slotId,
        localMm: local,
        worldMm: { xMm: world.xMm, yMm: world.yMm },
      })
    }
  }

  ingestMainTargets({ tsMain, targets }) {
    const mainTs = Number(tsMain) || Date.now()
    const list = Array.isArray(targets) ? targets : []

    const rows = []

    const summary = {
      tsMain: mainTs,
      comparable: 0,
      ok: 0,
      warn: 0,
      error: 0,
      missingRaw: 0,
    }

    for (const t of list) {
      const dbg = t?.debug || null
      const lm = dbg?.lastMeas || null
      const wm = lm?.worldMeasMm || null
      const loc = lm?.localMm || null
      if (!lm || !wm || !loc) continue

      const radarId = Number(lm.radarId)
      const slotId = Number(lm.slotId)
      const measTs = Number(lm.measTs)

      const debugLocal = { xMm: Number(loc.xMm), yMm: Number(loc.yMm) }
      const debugWorld = { xMm: Number(wm.xMm), yMm: Number(wm.yMm) }

      if (![radarId, slotId, debugLocal.xMm, debugLocal.yMm, debugWorld.xMm, debugWorld.yMm].every(Number.isFinite)) {
        continue
      }

      const worldFromUi = this.#xform.toWorldMm({ radarId, xMm: debugLocal.xMm, yMm: debugLocal.yMm })
      const uiWorld = { xMm: Number(worldFromUi.xMm), yMm: Number(worldFromUi.yMm) }

      const dWorld = distMm(uiWorld, debugWorld)
      const dtMeas = Number.isFinite(measTs) ? mainTs - measTs : null

      const raw = this.#rawLatestByKey.get(keyOf(radarId, slotId)) || null
      const dLocal = raw ? distMm(raw.localMm, debugLocal) : null
      const dtRaw = raw ? mainTs - raw.ts : null

      summary.comparable += 1

      if (raw) {
        if (Number.isFinite(dLocal)) this.#wLocal.push(dLocal)
        if (Number.isFinite(dtRaw)) this.#wRawAge.push(dtRaw)
      } else {
        summary.missingRaw += 1
      }

      if (Number.isFinite(dWorld)) this.#wWorld.push(dWorld)
      if (Number.isFinite(dtMeas)) this.#wMeasAge.push(dtMeas)

      const okLocal = dLocal !== null && dLocal <= this.#tol.localMm
      const okWorld = dWorld !== null && dWorld <= this.#tol.worldMm
      const okMeasAge = dtMeas !== null && dtMeas <= this.#tol.measAgeMs
      const okRawAge = dtRaw !== null && dtRaw <= this.#tol.rawMatchAgeMs

      const levels = []

      // Local compare depends on raw being present
      let localLevel = 'ok'
      if (!raw) localLevel = 'warn'
      else if (!okLocal) localLevel = 'error'

      // World compare is strong invariant: mismatch is real error
      const worldLevel = okWorld ? 'ok' : 'error'

      // Timing: treat meas age violations as warn (pipeline/UI timing), raw age as warn too
      const measAgeLevel = okMeasAge ? 'ok' : 'warn'
      const rawAgeLevel = okRawAge ? 'ok' : 'warn'

      levels.push(localLevel, worldLevel, measAgeLevel, rawAgeLevel)

      const level = maxLevel(levels)

      if (level === 'ok') summary.ok += 1
      else if (level === 'warn') summary.warn += 1
      else summary.error += 1

      rows.push({
        id: String(t.id || ''),
        radarId,
        slotId,
        publishAs: String(lm.publishAs || ''),
        dtMeas,
        dtRaw,
        dLocal,
        dWorld,
        okLocal,
        okWorld,
        okMeasAge,
        okRawAge,
        hasRaw: Boolean(raw),

        localLevel,
        worldLevel,
        measAgeLevel,
        rawAgeLevel,
        level,
      })
    }

    // Sort: show worst first for UI (error -> warn -> ok)
    const levelOrder = { error: 0, warn: 1, ok: 2 }
    rows.sort((a, b) => {
      const la = levelOrder[a.level] ?? 9
      const lb = levelOrder[b.level] ?? 9
      if (la !== lb) return la - lb
      const ra = Number(a.radarId) - Number(b.radarId)
      if (ra !== 0) return ra
      return Number(a.slotId) - Number(b.slotId)
    })

    this.#rows = rows
    this.#summary = summary
  }

  snapshot() {
    const tol = this.tolerances()

    const stats = {
      localMax: this.#wLocal.max(),
      localMed: this.#wLocal.median(),
      worldMax: this.#wWorld.max(),
      worldMed: this.#wWorld.median(),
      measAgeMax: this.#wMeasAge.max(),
      measAgeMed: this.#wMeasAge.median(),
      rawAgeMax: this.#wRawAge.max(),
      rawAgeMed: this.#wRawAge.median(),
    }

    const totals = this.#summary || {}

    const level = (() => {
      if ((totals.error || 0) > 0) return 'error'
      if ((totals.warn || 0) > 0) return 'warn'
      return 'ok'
    })()

    return {
      tol,
      stats,
      summary: {
        ...totals,
        level,
      },
      rows: this.#rows,
    }
  }
}
