// src/domains/presence/tracking/associationEngine.js
export class AssociationEngine {
  #gateD2Max
  #tentativePenalty
  #radarSwitchPenaltyFn

  constructor({ gateD2Max, tentativePenalty, radarSwitchPenaltyFn } = {}) {
    this.#gateD2Max = Number(gateD2Max) || 9.21
    this.#tentativePenalty = Math.max(0, Number(tentativePenalty) || 0)
    this.#radarSwitchPenaltyFn = typeof radarSwitchPenaltyFn === 'function'
      ? radarSwitchPenaltyFn
      : () => 0
  }

  associate({ tracks, measurements, measVarMm2ByIdx } = {}) {
    const trackList = Array.isArray(tracks) ? tracks : []
    const measList = Array.isArray(measurements) ? measurements : []
    const vars = Array.isArray(measVarMm2ByIdx) ? measVarMm2ByIdx : []

    const assignments = new Map() // trackId -> measIndex
    const unassignedMeas = []
    const unassignedTracks = []

    if (trackList.length === 0 && measList.length === 0) {
      return { assignments, unassignedMeas, unassignedTracks }
    }

    const validTracks = []
    const seenTrackIds = new Set()

    for (const t of trackList) {
      const id = typeof t?.id === 'string' ? t.id.trim() : ''
      if (!id || seenTrackIds.has(id)) continue

      const xMm = Number(t?.xMm)
      const yMm = Number(t?.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      seenTrackIds.add(id)

      const state = String(t?.state || '')
      const ageMs = Number(t?.ageMs)

      validTracks.push({
        id,
        xMm,
        yMm,
        state,
        ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0,
        raw: t,
      })
    }

    const validMeas = []
    for (let i = 0; i < measList.length; i += 1) {
      const m = measList[i]
      const xMm = Number(m?.xMm)
      const yMm = Number(m?.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      const varMm2 = Math.max(1, Number(vars[i]) || 1)
      validMeas.push({ idx: i, xMm, yMm, varMm2, raw: m })
    }

    if (validTracks.length === 0 && validMeas.length === 0) {
      return { assignments, unassignedMeas, unassignedTracks }
    }

    if (validTracks.length === 0) {
      for (const m of validMeas) unassignedMeas.push(m.idx)
      return { assignments, unassignedMeas, unassignedTracks }
    }

    if (validMeas.length === 0) {
      for (const t of validTracks) unassignedTracks.push(t.id)
      return { assignments, unassignedMeas, unassignedTracks }
    }

    const candidates = []
    for (const t of validTracks) {
      const isTentative = t.state === 'tentative'
      const stateRank = isTentative ? 1 : 0

      for (const m of validMeas) {
        const gateMm2 = this.#gateD2Max * m.varMm2

        const dx = (m.xMm - t.xMm)
        const dy = (m.yMm - t.yMm)
        const dist2 = (dx * dx) + (dy * dy)
        if (dist2 > gateMm2) continue

        const d2 = dist2 / m.varMm2

        let cost = d2
        if (isTentative) cost += this.#tentativePenalty
        cost += Math.max(0, Number(this.#radarSwitchPenaltyFn(t.raw, m.raw)) || 0)

        candidates.push({
          trackId: t.id,
          trackAgeMs: t.ageMs,
          trackStateRank: stateRank,
          measIdx: m.idx,
          cost,
        })
      }
    }

    const usedMeas = new Set()
    const usedTracks = new Set()

    candidates.sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost
      if (a.trackStateRank !== b.trackStateRank) return a.trackStateRank - b.trackStateRank
      if (a.trackAgeMs !== b.trackAgeMs) return b.trackAgeMs - a.trackAgeMs
      if (a.trackId !== b.trackId) return a.trackId < b.trackId ? -1 : 1
      return a.measIdx - b.measIdx
    })

    for (const c of candidates) {
      if (usedTracks.has(c.trackId) || usedMeas.has(c.measIdx)) continue
      usedTracks.add(c.trackId)
      usedMeas.add(c.measIdx)
      assignments.set(c.trackId, c.measIdx)
    }

    for (const t of validTracks) {
      if (!usedTracks.has(t.id)) {
        unassignedTracks.push(t.id)
      }
    }

    for (const m of validMeas) {
      if (!usedMeas.has(m.idx)) {
        unassignedMeas.push(m.idx)
      }
    }

    return { assignments, unassignedMeas, unassignedTracks }
  }
}

export default AssociationEngine
