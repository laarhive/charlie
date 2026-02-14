// public/dev/radar/renderer.js
// NOTE: helper/common math moved to ./utils.js
import { degToRad, wrapDeg, clamp01, clamp } from './utils.js'

/* world frame: +X North, +Y East (clockwise bearings) */
export class PresenceRenderer {
  #canvas
  #ctx
  #cfg

  #trackHueBySeq = new Map()
  #trackHueOrder = []
  #maxTrackColors = 30

  /* 4 reserved base hues for raw targets: R, G, B, (4th = amber) */
  #rawBaseHueByRadar = [0, 120, 240, 45]

  /* 3 nuanced shades per radar (same base hue, different lightness/alpha) */
  #rawShadeBySlot = [
    { s: 95, l: 58, a: 0.90 },
    { s: 90, l: 50, a: 0.75 },
    { s: 85, l: 42, a: 0.60 },
  ]

  constructor({ canvas, cfg }) {
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    this.#cfg = cfg
  }

  setConfig(cfg) {
    this.#cfg = cfg
  }

  render({ tracks, rawTrails, trackTrails }) {
    const ctx = this.#ctx
    const w = this.#canvas.width
    const h = this.#canvas.height

    ctx.clearRect(0, 0, w, h)

    const scale = Number(this.#cfg.draw.scalePxPerMm) || 0.2

    const cx = Math.floor(w / 2)
    const cy = Math.floor(h / 2)

    this.#drawBackground({ ctx, w, h })
    if (this.#cfg.draw.showGrid) this.#drawGrid({ ctx, cx, cy, scale, w, h })

    this.#drawAxes({ ctx, cx, cy })
    this.#drawLayout({ ctx, cx, cy, scale })

    this.#drawRawTrails({ ctx, cx, cy, scale, rawTrails })
    this.#drawTrackTrails({ ctx, cx, cy, scale, tracks, trackTrails })

    // KF/association overlay from main-bus embedded debug
    this.#drawTrackDebugOverlay({ ctx, cx, cy, scale, tracks })

    if (this.#cfg.draw.showTracks) {
      this.#drawTracks({ ctx, cx, cy, scale, tracks })
    }
  }

  #drawBackground({ ctx, w, h }) {
    ctx.fillStyle = '#070a0f'
    ctx.fillRect(0, 0, w, h)
  }

  #drawGrid({ ctx, cx, cy, scale, w, h }) {
    const stepMm = 500
    const stepPx = stepMm * scale

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1

    for (let x = cx % stepPx; x < w; x += stepPx) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }

    for (let y = cy % stepPx; y < h; y += stepPx) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    ctx.restore()
  }

  #drawAxes({ ctx, cx, cy }) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1.5

    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, this.#canvas.height)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(this.#canvas.width, cy)
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '12px ui-monospace'
    ctx.fillText('N (+X)', cx + 6, 14)
    ctx.fillText('E (+Y)', this.#canvas.width - 60, cy - 6)

    ctx.restore()
  }

  #hsl = ({ h, s, l, a }) => `hsla(${h}, ${s}%, ${l}%, ${a})`

  #rawSlotIndex = (localId) => {
    const n = Number(localId)
    if (!Number.isFinite(n)) return 0

    const i = Math.round(n) - 1
    if (i < 0) return 0
    if (i > 2) return 2
    return i
  }

  #rawStyle = ({ radarId, localId, lightnessOffset = 0, alphaMul = 1 }) => {
    const rid = Number.isFinite(Number(radarId)) ? Number(radarId) : 0
    const hue = this.#rawBaseHueByRadar[rid] ?? this.#rawBaseHueByRadar[0]

    const slot = this.#rawSlotIndex(localId)
    const shade = this.#rawShadeBySlot[slot] ?? this.#rawShadeBySlot[0]

    const l = clamp(shade.l + lightnessOffset, 18, 78)
    const a = clamp(shade.a * alphaMul, 0, 1)

    return this.#hsl({ h: hue, s: shade.s, l, a })
  }

  #drawLayout({ ctx, cx, cy, scale }) {
    const az = this.#cfg.layout.radarAzimuthDeg || []
    const fov = Number(this.#cfg.layout.radarFovDeg) || 120

    const tubeDiameterMm = Number(this.#cfg.layout.tubeDiameterMm) || 100
    const tubeRadiusMm = tubeDiameterMm / 2
    const tubeRpx = tubeRadiusMm * scale

    const rMaxMm = Number(this.#cfg.draw.rMaxMm) || 3000
    const rMaxPx = rMaxMm * scale

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, tubeRpx, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, rMaxPx, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    for (let i = 0; i < az.length; i += 1) {
      const phi = Number(az[i])
      if (!Number.isFinite(phi)) continue

      const rad = degToRad(phi)

      const txMm = tubeRadiusMm * Math.cos(rad)
      const tyMm = tubeRadiusMm * Math.sin(rad)

      const sx = cx + (tyMm * scale)
      const sy = cy - (txMm * scale)

      const hue = this.#rawBaseHueByRadar[i] ?? 0

      ctx.save()
      ctx.fillStyle = this.#hsl({ h: hue, s: 90, l: 55, a: 0.32 })
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(sx, sy, 8, 0, Math.PI * 2)
      ctx.stroke()

      ctx.font = '12px ui-monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.fillText(`R${i} ${phi}°`, sx + 10, sy - 8)

      ctx.restore()

      if (this.#cfg.draw.showFov) {
        this.#drawFov({ ctx, cx, cy, scale, phiDeg: phi, fovDeg: fov, rMaxMm })
      }
    }
  }

  #drawFov({ ctx, cx, cy, scale, phiDeg, fovDeg, rMaxMm }) {
    const half = fovDeg / 2

    const a0 = degToRad(wrapDeg(phiDeg - half))
    const a1 = degToRad(wrapDeg(phiDeg + half))

    const toScreenAngle = function toScreenAngle(thetaRad) {
      const x = Math.cos(thetaRad)
      const y = Math.sin(thetaRad)
      return Math.atan2(-x, y)
    }

    const s0 = toScreenAngle(a0)
    const s1 = toScreenAngle(a1)

    const rPx = rMaxMm * scale

    ctx.save()
    ctx.fillStyle = 'rgba(106,169,255,0.06)'
    ctx.strokeStyle = 'rgba(106,169,255,0.18)'
    ctx.lineWidth = 1

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, rPx, s0, s1, false)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.restore()
  }

  // alpha is ONLY for time fade (no speed influence)
  #trailAlpha = ({ ts, keepS, base = 0.8 }) => {
    if (keepS === -1) return base

    const k = Number(keepS)
    if (!Number.isFinite(k) || k <= 0) return 0

    const ageMs = Date.now() - (Number(ts) || Date.now())
    const t = ageMs / (k * 1000)
    if (t >= 1) return 0

    return base * (1 - t)
  }

  #segmentSpeedMmS = ({ a, b }) => {
    const ax = Number(a.xMm)
    const ay = Number(a.yMm)
    const bx = Number(b.xMm)
    const by = Number(b.yMm)
    const at = Number(a.ts)
    const bt = Number(b.ts)

    if (![ax, ay, bx, by, at, bt].every(Number.isFinite)) return null

    const dt = Math.max(1, bt - at) / 1000
    const dx = bx - ax
    const dy = by - ay
    const dist = Math.sqrt((dx * dx) + (dy * dy))
    return dist / dt
  }

  // speed -> lightness offset (slower brighter, faster darker), DOES NOT affect alpha
  #lightnessOffsetBySpeed = (speedMmS, vRefMmS) => {
    if (!Number.isFinite(speedMmS)) return 0

    const t = clamp01(speedMmS / vRefMmS)
    return 10 - (22 * t) // slow => +10, fast => -12
  }

  #drawRawTrails({ ctx, cx, cy, scale, rawTrails }) {
    const keepS = Number(this.#cfg?.draw?.rawTrailKeepS)
    if (keepS === 0) return
    if (!this.#cfg.draw.showMeasurements) return
    if (!rawTrails || typeof rawTrails.entries !== 'function') return

    ctx.save()
    ctx.lineWidth = 2

    for (const [, list] of rawTrails.entries()) {
      if (!Array.isArray(list) || list.length < 2) continue

      for (let i = 1; i < list.length; i += 1) {
        const a = list[i - 1]
        const b = list[i]

        const alpha = this.#trailAlpha({ ts: a.ts, keepS, base: 0.70 })
        if (alpha <= 0.001) continue

        const segSpeed = this.#segmentSpeedMmS({ a, b })
        const lOff = this.#lightnessOffsetBySpeed(segSpeed, 1800)

        const ax = cx + (Number(a.yMm) * scale)
        const ay = cy - (Number(a.xMm) * scale)
        const bx = cx + (Number(b.yMm) * scale)
        const by = cy - (Number(b.xMm) * scale)

        if (![ax, ay, bx, by].every(Number.isFinite)) continue

        ctx.globalAlpha = 1
        ctx.strokeStyle = this.#rawStyle({
          radarId: a.radarId,
          localId: a.localId,
          lightnessOffset: lOff,
          alphaMul: alpha,
        })

        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }

      const last = list[list.length - 1]
      const prev = list.length >= 2 ? list[list.length - 2] : null
      const curSpeed = prev ? this.#segmentSpeedMmS({ a: prev, b: last }) : null
      const lOffCur = this.#lightnessOffsetBySpeed(curSpeed, 1800)

      const lx = cx + (Number(last.yMm) * scale)
      const ly = cy - (Number(last.xMm) * scale)
      if ([lx, ly].every(Number.isFinite)) {
        ctx.globalAlpha = 1
        ctx.fillStyle = this.#rawStyle({
          radarId: last.radarId,
          localId: last.localId,
          lightnessOffset: lOffCur,
          alphaMul: 0.85,
        })

        ctx.beginPath()
        ctx.arc(lx, ly, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.restore()
  }

  #avoidHue = (h) => {
    const base = this.#rawBaseHueByRadar
    let hue = ((h % 360) + 360) % 360

    const tooClose = (x, y) => {
      const d = Math.abs(x - y)
      const wrap = Math.min(d, 360 - d)
      return wrap < 22
    }

    for (let tries = 0; tries < 10; tries += 1) {
      if (!base.some((bh) => tooClose(hue, bh))) return hue
      hue = (hue + 29) % 360
    }

    return hue
  }

  #parseTrackSeq = (id) => {
    const s = String(id || '')
    const i = s.lastIndexOf(':')
    if (i === -1) return null

    const n = Number(s.slice(i + 1))
    return Number.isFinite(n) ? n : null
  }

  #getTrackHue = (t) => {
    const isTentative = String(t.state || '') === 'tentative'
    if (isTentative) return this.#avoidHue(300)

    const seq = this.#parseTrackSeq(t.id)
    if (seq === null) return this.#avoidHue(160)

    let hue = this.#trackHueBySeq.get(seq)
    if (Number.isFinite(hue)) return hue

    hue = this.#avoidHue((seq * 137.508) % 360)
    this.#trackHueBySeq.set(seq, hue)
    this.#trackHueOrder.push(seq)

    if (this.#trackHueOrder.length > this.#maxTrackColors) {
      const oldSeq = this.#trackHueOrder.shift()
      this.#trackHueBySeq.delete(oldSeq)
    }

    return hue
  }

  #trackStyle = ({ t, lightnessOffset = 0, alphaMul = 1 }) => {
    const hue = this.#getTrackHue(t)
    const l = clamp(55 + lightnessOffset, 18, 78)
    const a = clamp(0.85 * alphaMul, 0, 1)
    return this.#hsl({ h: hue, s: 90, l, a })
  }

  #drawStar = ({ ctx, x, y, rOuter, rInner, points = 5 }) => {
    const step = Math.PI / points

    ctx.beginPath()
    for (let i = 0; i < 2 * points; i += 1) {
      const r = i % 2 === 0 ? rOuter : rInner
      const a = -Math.PI / 2 + i * step
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }

    ctx.closePath()
  }

  #drawTrackTrails({ ctx, cx, cy, scale, tracks, trackTrails }) {
    const keepS = Number(this.#cfg?.draw?.trackTrailKeepS)
    if (keepS === 0) return
    if (!this.#cfg.draw.showTracks) return
    if (!trackTrails || typeof trackTrails.entries !== 'function') return

    const trackById = new Map()
    for (const t of tracks || []) {
      trackById.set(String(t.id || ''), t)
    }

    ctx.save()
    ctx.lineWidth = 2.5

    for (const [id, list] of trackTrails.entries()) {
      if (!Array.isArray(list) || list.length < 2) continue

      const t = trackById.get(id) || { id, state: 'confirmed' }
      const baseHue = this.#getTrackHue(t)

      for (let i = 1; i < list.length; i += 1) {
        const a = list[i - 1]
        const b = list[i]

        const alpha = this.#trailAlpha({ ts: a.ts, keepS, base: 0.55 })
        if (alpha <= 0.001) continue

        const segSpeed = this.#segmentSpeedMmS({ a, b })
        const lOff = this.#lightnessOffsetBySpeed(segSpeed, 2200)

        const ax = cx + (Number(a.yMm) * scale)
        const ay = cy - (Number(a.xMm) * scale)
        const bx = cx + (Number(b.yMm) * scale)
        const by = cy - (Number(b.xMm) * scale)

        if (![ax, ay, bx, by].every(Number.isFinite)) continue

        ctx.globalAlpha = 1
        ctx.strokeStyle = this.#hsl({
          h: baseHue,
          s: 90,
          l: clamp(55 + lOff, 18, 78),
          a: clamp(0.85 * alpha, 0, 1),
        })

        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  // Overlay: KF/association (uses track.debug.lastMeas + track.debug.kf + track.debug.assoc)
  #drawTrackDebugOverlay({ ctx, cx, cy, scale, tracks }) {
    if (!Array.isArray(tracks) || tracks.length === 0) return

    for (const t of tracks) {
      const dbg = t?.debug || null
      const lm = dbg?.lastMeas || null
      const wm = lm?.worldMeasMm || null
      if (!wm) continue

      const tx = Number(t.xMm)
      const ty = Number(t.yMm)
      const mx = Number(wm.xMm)
      const my = Number(wm.yMm)
      if (![tx, ty, mx, my].every(Number.isFinite)) continue

      const tsx = cx + (ty * scale)
      const tsy = cy - (tx * scale)
      const msx = cx + (my * scale)
      const msy = cy - (mx * scale)

      const gateD2 = Number(dbg?.assoc?.gateD2)
      const assigned = dbg?.assoc?.assigned !== false
      const sigmaMm = Number(dbg?.kf?.sigmaMm)
      const upd = Boolean(dbg?.updatedThisTick)

      const measTs = Number(lm.measTs)
      const trackTs = Number(t._ts ?? t.ts ?? 0)
      const dtMs = Number.isFinite(measTs) && Number.isFinite(trackTs) && trackTs > 0 ? trackTs - measTs : null

      const assocStroke = (() => {
        if (!assigned) return 'rgba(255,80,80,0.75)'
        if (!Number.isFinite(gateD2)) return 'rgba(255,255,255,0.35)'
        if (gateD2 < 0.2) return 'rgba(80,255,120,0.75)'
        if (gateD2 < 1.0) return 'rgba(255,220,90,0.70)'
        return 'rgba(255,120,80,0.70)'
      })()

      // sigma circle (confidence proxy)
      if (Number.isFinite(sigmaMm) && sigmaMm > 0) {
        const rPx = (sigmaMm * 2) * scale
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(tsx, tsy, rPx, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // association line track->meas
      ctx.save()
      ctx.strokeStyle = assocStroke
      ctx.lineWidth = upd ? 2.5 : 1.5
      ctx.beginPath()
      ctx.moveTo(tsx, tsy)
      ctx.lineTo(msx, msy)
      ctx.stroke()
      ctx.restore()

      // measurement point: use radar base hue
      const rid = Number.isFinite(Number(lm.radarId)) ? Number(lm.radarId) : 0
      const baseHue = this.#rawBaseHueByRadar[rid] ?? 0

      ctx.save()
      ctx.fillStyle = this.#hsl({ h: baseHue, s: 90, l: 60, a: 0.85 })
      ctx.beginPath()
      ctx.arc(msx, msy, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // small label near track: d2 + dt
      ctx.save()
      ctx.font = '11px ui-monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.55)'

      const parts = []
      if (upd) parts.push('u')
      if (Number.isFinite(gateD2)) parts.push(`d2=${gateD2.toFixed(2)}`)
      if (Number.isFinite(sigmaMm)) parts.push(`σ=${Math.round(sigmaMm)}`)
      if (Number.isFinite(dtMs)) parts.push(`Δt=${Math.round(dtMs)}ms`)

      if (parts.length) {
        ctx.fillText(parts.join(' '), tsx + 10, tsy + 14)
      }

      ctx.restore()
    }
  }

  #drawTracks({ ctx, cx, cy, scale, tracks }) {
    const velScale = Number(this.#cfg.draw.velocityArrowScale) || 8

    for (const t of tracks) {
      const xMm = Number(t.xMm)
      const yMm = Number(t.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      const sx = cx + (yMm * scale)
      const sy = cy - (xMm * scale)

      const speedMmS = Number(t.speedMmS)
      const lOff = this.#lightnessOffsetBySpeed(speedMmS, 2200)

      ctx.save()

      ctx.globalAlpha = 1
      ctx.fillStyle = this.#trackStyle({ t, lightnessOffset: lOff, alphaMul: 1 })

      this.#drawStar({ ctx, x: sx, y: sy, rOuter: 7, rInner: 3.5, points: 5 })
      ctx.fill()

      const vx = Number(t.vxMmS)
      const vy = Number(t.vyMmS)

      if (Number.isFinite(vx) && Number.isFinite(vy)) {
        const ex = sx + (vy * velScale * 0.01)
        const ey = sy - (vx * velScale * 0.01)

        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(ex, ey)
        ctx.stroke()
      }

      ctx.font = '12px ui-monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillText(String(t.id || '').slice(0, 18), sx + 10, sy - 10)

      ctx.restore()
    }
  }
}

export default PresenceRenderer
