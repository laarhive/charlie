// public/dev/presence/monitor/compareMonitor.js

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

export default class Ld2450RawTargetsConsistencyMonitor {
  #cfg
  #xform

  #tol

  // latest raw by radar/slot
  #rawLatestByKey = new Map() // key -> { ts, radarId, slotId, localMm:{x,y}, worldMm:{x,y} }

  // rolling stats (last N track updates)
  #wLocal = new StatsWindow({ maxN: 250 })
  #wWorld = new StatsWindow({ maxN: 250 })
  #wMeasAge = new StatsWindow({ maxN: 250 })
  #wRawAge = new StatsWindow({ maxN: 250 })

  // last computed rows for panel
  #rows = []

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

      const worldFromUi = this.#xform.toWorldMm({ radarId, xMm: debugLocal.xMm, yMm: debugLocal.yMm })
      const uiWorld = { xMm: Number(worldFromUi.xMm), yMm: Number(worldFromUi.yMm) }

      const dWorld = distMm(uiWorld, debugWorld)
      const dtMeas = Number.isFinite(measTs) ? mainTs - measTs : null

      // compare to latest raw (best-effort)
      const raw = this.#rawLatestByKey.get(keyOf(radarId, slotId)) || null
      const dLocal = raw ? distMm(raw.localMm, debugLocal) : null
      const dtRaw = raw ? mainTs - raw.ts : null

      if (Number.isFinite(dLocal)) this.#wLocal.push(dLocal)
      if (Number.isFinite(dWorld)) this.#wWorld.push(dWorld)
      if (Number.isFinite(dtMeas)) this.#wMeasAge.push(dtMeas)
      if (Number.isFinite(dtRaw)) this.#wRawAge.push(dtRaw)

      const okLocal = dLocal === null ? false : dLocal <= this.#tol.localMm
      const okWorld = dWorld === null ? false : dWorld <= this.#tol.worldMm
      const okMeasAge = dtMeas === null ? false : dtMeas <= this.#tol.measAgeMs
      const okRawAge = dtRaw === null ? false : dtRaw <= this.#tol.rawMatchAgeMs

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
      })
    }

    this.#rows = rows
  }

  snapshot() {
    const tol = this.tolerances()
    return {
      tol,
      rows: this.#rows,
      stats: {
        localMax: this.#wLocal.max(),
        localMed: this.#wLocal.median(),
        worldMax: this.#wWorld.max(),
        worldMed: this.#wWorld.median(),
        measAgeMax: this.#wMeasAge.max(),
        measAgeMed: this.#wMeasAge.median(),
        rawAgeMax: this.#wRawAge.max(),
        rawAgeMed: this.#wRawAge.median(),
      },
    }
  }
}
