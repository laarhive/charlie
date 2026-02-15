// src/domains/presence/tracking/associationEngine.js
export class AssociationEngine {
  #gateD2Max

  constructor({ gateD2Max }) {
    this.#gateD2Max = Number(gateD2Max) || 9.21
  }

  associate({ tracks, measurements, measVarMm2ByIdx }) {
    const usedMeas = new Set()
    const assignments = new Map() // trackId -> measIndex
    const unassignedMeas = []

    const vars = Array.isArray(measVarMm2ByIdx) ? measVarMm2ByIdx : []

    for (const t of tracks) {
      let bestIdx = -1
      let bestD2 = Infinity

      for (let i = 0; i < measurements.length; i += 1) {
        if (usedMeas.has(i)) continue

        const m = measurements[i]
        const varMm2 = Number(vars[i]) || 1

        const dx = (m.xMm - t.xMm)
        const dy = (m.yMm - t.yMm)

        const d2 = ((dx * dx) + (dy * dy)) / Math.max(1, varMm2)

        if (d2 <= this.#gateD2Max && d2 < bestD2) {
          bestD2 = d2
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        usedMeas.add(bestIdx)
        assignments.set(t.id, bestIdx)
      }
    }

    for (let i = 0; i < measurements.length; i += 1) {
      if (!usedMeas.has(i)) {
        unassignedMeas.push(i)
      }
    }

    return { assignments, unassignedMeas }
  }
}

export default AssociationEngine
