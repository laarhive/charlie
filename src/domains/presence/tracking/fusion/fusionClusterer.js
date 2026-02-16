// src/domains/presence/tracking/fusion/fusionClusterer.js

import { mapScale } from '../debug/trackingDebugFormat.js'

class Uf {
  #parent
  #rank

  constructor(n) {
    this.#parent = Array.from({ length: n }, (_, i) => i)
    this.#rank = Array(n).fill(0)
  }

  find(x) {
    let p = this.#parent[x]
    if (p !== x) {
      p = this.find(p)
      this.#parent[x] = p
    }

    return p
  }

  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)

    if (ra === rb) return

    const ka = this.#rank[ra]
    const kb = this.#rank[rb]

    if (ka < kb) {
      this.#parent[ra] = rb
      return
    }

    if (kb < ka) {
      this.#parent[rb] = ra
      return
    }

    this.#parent[rb] = ra
    this.#rank[ra] += 1
  }
}

export class FusionClusterer {
  #cfg
  #transform

  constructor({ cfg, transform }) {
    this.#cfg = cfg || {}
    this.#transform = transform
  }

  cluster({ observations, measVarMm2ByIdx, now, debugEnabled }) {
    const enabled = this.#cfg?.tracking?.fusion?.enabled === true
    const meas = Array.isArray(observations) ? observations : []
    const vars = Array.isArray(measVarMm2ByIdx) ? measVarMm2ByIdx : []

    if (!enabled || meas.length <= 1) {
      return {
        observations: meas,
        measVarMm2ByIdx: vars,
        debug: {
          enabled,
          clustersOut: meas.length,
          clustersMultiRadar: 0,
          clusterGateMm: Number(this.#cfg?.tracking?.fusion?.clusterGateMm ?? 450),
          clusterRadiusMmMax: 0,
          clusterRadiusMmP95: 0,
          mergesCrossRadar: 0,
          mergeRejectedNotVisible: 0,
        },
      }
    }

    const gateMm = Number(this.#cfg?.tracking?.fusion?.clusterGateMm ?? 450)
    const gate2 = Math.max(1, gateMm * gateMm)

    const maxClusterSize = Number(this.#cfg?.tracking?.fusion?.maxClusterSize ?? 10)
    const fovMarginDeg = Number(this.#cfg?.tracking?.fusion?.fovMarginDeg ?? 6)
    const rangeMarginMm = Number(this.#cfg?.tracking?.fusion?.rangeMarginMm ?? 150)

    const q = this.#cfg?.quality || {}
    const cutoffDeg = Number(q.edgeBearingCutoffDeg ?? 45)
    const rangeCutoffMm = Number(q.rangeCutoffMm ?? 3000)

    const fovDeg = Number(this.#cfg?.layout?.radarFovDeg ?? 120)
    const halfFov = Number.isFinite(fovDeg) ? Math.abs(fovDeg) / 2 : 60

    const bearingAbsMax = Math.min(
      Number.isFinite(cutoffDeg) ? Math.abs(cutoffDeg) : 180,
      Number.isFinite(halfFov) ? halfFov : 180,
    ) + (Number.isFinite(fovMarginDeg) ? Math.abs(fovMarginDeg) : 0)

    const rangeMax = (Number.isFinite(rangeCutoffMm) ? rangeCutoffMm : 3000) + (Number.isFinite(rangeMarginMm) ? Math.abs(rangeMarginMm) : 0)

    const n = meas.length
    const uf = new Uf(n)

    let mergesCrossRadar = 0
    let mergeRejectedNotVisible = 0

    const isVisible = (radarId, wx, wy) => {
      const loc = this.#transform.toLocalMm({ radarId, xMm: wx, yMm: wy })
      const x = Number(loc?.xMm)
      const y = Number(loc?.yMm)

      if (!Number.isFinite(x) || !Number.isFinite(y)) return false

      const bearingDeg = (Math.atan2(x, y) * 180) / Math.PI
      const absB = Math.abs(bearingDeg)
      if (absB > bearingAbsMax) return false

      const r = Math.sqrt((x * x) + (y * y))
      if (!Number.isFinite(r)) return false
      if (r > rangeMax) return false

      return true
    }

    for (let i = 0; i < n; i += 1) {
      const a = meas[i]

      for (let j = i + 1; j < n; j += 1) {
        const b = meas[j]

        const dx = a.xMm - b.xMm
        const dy = a.yMm - b.yMm
        const d2 = (dx * dx) + (dy * dy)

        if (d2 > gate2) continue

        if (a.radarId === b.radarId) {
          uf.union(i, j)
          continue
        }

        const cx = (a.xMm + b.xMm) / 2
        const cy = (a.yMm + b.yMm) / 2

        const visA = isVisible(a.radarId, cx, cy)
        const visB = isVisible(b.radarId, cx, cy)

        if (visA && visB) {
          mergesCrossRadar += 1
          uf.union(i, j)
          continue
        }

        mergeRejectedNotVisible += 1
      }
    }

    const groups = new Map()
    for (let i = 0; i < n; i += 1) {
      const r = uf.find(i)

      if (!groups.has(r)) groups.set(r, [])
      groups.get(r).push(i)
    }

    const fused = []
    const fusedVar = []

    const clusterRadius = []
    let clustersMultiRadar = 0

    for (const idxs of groups.values()) {
      if (idxs.length === 1) {
        const i = idxs[0]
        fused.push(meas[i])
        fusedVar.push(Number(vars[i]) || 1)
        clusterRadius.push(0)
        continue
      }

      if (Number.isFinite(maxClusterSize) && maxClusterSize > 0 && idxs.length > maxClusterSize) {
        for (const i of idxs) {
          fused.push(meas[i])
          fusedVar.push(Number(vars[i]) || 1)
          clusterRadius.push(0)
        }

        continue
      }

      let sumW = 0
      let sumX = 0
      let sumY = 0
      let tsMax = 0

      const radarSet = new Set()
      const zoneSet = new Set()

      const members = debugEnabled ? [] : null

      let bestIdx = idxs[0]
      let bestVar = Infinity

      for (const i of idxs) {
        const m = meas[i]
        const varMm2 = Number(vars[i]) || 1
        const w = 1 / Math.max(1, varMm2)

        sumW += w
        sumX += w * m.xMm
        sumY += w * m.yMm

        tsMax = Math.max(tsMax, Number(m.measTs) || 0)

        radarSet.add(m.radarId)
        if (m.zoneId) zoneSet.add(m.zoneId)

        if (varMm2 < bestVar) {
          bestVar = varMm2
          bestIdx = i
        }

        if (debugEnabled) {
          members.push({
            radarId: m.radarId,
            zoneId: m.zoneId,
            xMm: m.xMm,
            yMm: m.yMm,
            measTs: m.measTs,
            varMm2,
          })
        }
      }

      const cx = sumW > 0 ? (sumX / sumW) : meas[bestIdx].xMm
      const cy = sumW > 0 ? (sumY / sumW) : meas[bestIdx].yMm

      let rMax = 0
      for (const i of idxs) {
        const m = meas[i]
        const dx = m.xMm - cx
        const dy = m.yMm - cy
        const d = Math.sqrt((dx * dx) + (dy * dy))
        if (Number.isFinite(d)) rMax = Math.max(rMax, d)
      }

      clusterRadius.push(rMax)

      if (radarSet.size > 1) clustersMultiRadar += 1

      const rep = meas[bestIdx]
      const repProv = rep?.prov || null

      const fusedItem = {
        measTs: tsMax || rep.measTs,
        radarId: rep.radarId,
        zoneId: zoneSet.size === 1 ? [...zoneSet][0] : rep.zoneId,

        xMm: cx,
        yMm: cy,

        sourceRadars: [...radarSet],

        prov: repProv,
      }

      if (debugEnabled) {
        fusedItem.fusion = {
          members,
          membersCount: idxs.length,
          radiusMm: rMax,
        }
      }

      fused.push(fusedItem)

      const fusedVarMm2 = sumW > 0 ? (1 / sumW) : (Number(vars[bestIdx]) || 1)
      fusedVar.push(fusedVarMm2)
    }

    clusterRadius.sort((a, b) => a - b)

    const radiusMax = clusterRadius.length > 0 ? clusterRadius[clusterRadius.length - 1] : 0
    const radiusP95 = clusterRadius.length > 0 ? this.#percentileFromSorted(clusterRadius, 0.95) : 0

    return {
      observations: fused,
      measVarMm2ByIdx: fusedVar,
      debug: {
        enabled,
        clustersOut: fused.length,
        clustersMultiRadar,
        clusterGateMm: gateMm,
        clusterRadiusMmMax: radiusMax,
        clusterRadiusMmP95: radiusP95,
        mergesCrossRadar,
        mergeRejectedNotVisible,
      },
    }
  }

  #percentileFromSorted(sortedAsc, p01) {
    if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return 0

    const p = Math.min(1, Math.max(0, Number(p01) || 0))
    const n = sortedAsc.length

    if (n === 1) return sortedAsc[0]

    const idx = Math.floor(p * (n - 1))
    return sortedAsc[Math.min(n - 1, Math.max(0, idx))]
  }
}

export default FusionClusterer
