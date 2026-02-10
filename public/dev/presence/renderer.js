// public/dev/radar/renderer.js
const degToRad = function degToRad(deg) {
  return (deg * Math.PI) / 180
}

const wrapDeg = function wrapDeg(deg) {
  let d = deg % 360
  if (d < -180) d += 360
  if (d > 180) d -= 360
  return d
}

/* world frame: +X North, +Y East (clockwise bearings) */
export class PresenceRenderer {
  #canvas
  #ctx
  #cfg

  #trackColorBySeq = new Map()
  #trackColorOrder = []
  #maxTrackColors = 30

  /* raw measurement palette: 4 radars x 3 target slots (nuanced) */
  #measPalette = [
    ['rgba(0, 255, 255, 0.85)', 'rgba(0, 255, 255, 0.55)', 'rgba(0, 255, 255, 0.30)'],   // R0
    ['rgba(255, 64, 64, 0.85)', 'rgba(255, 64, 64, 0.55)', 'rgba(255, 64, 64, 0.30)'],   // R1
    ['rgba(0, 255, 140, 0.85)', 'rgba(0, 255, 140, 0.55)', 'rgba(0, 255, 140, 0.30)'],   // R2
    ['rgba(255, 210, 0, 0.85)', 'rgba(255, 210, 0, 0.55)', 'rgba(255, 210, 0, 0.30)'],   // R3
  ]

  constructor({ canvas, cfg }) {
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    this.#cfg = cfg
  }

  setConfig(cfg) {
    this.#cfg = cfg
  }

  render({ measurements, tracks }) {
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

    if (this.#cfg.draw.showMeasurements) {
      this.#drawMeasurements({ ctx, cx, cy, scale, measurements })
    }

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

      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(sx, sy, 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = '12px ui-monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.fillText(`R${i} ${phi}°`, sx + 6, sy - 6)

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

  #measSlotIndex = (localId) => {
    const n = Number(localId)
    if (!Number.isFinite(n)) return 0

    // common LD2450 target ids are 1..3, normalize to 0..2
    const i = Math.round(n) - 1
    if (i < 0) return 0
    if (i > 2) return 2
    return i
  }

  #measFillStyle = ({ radarId, localId }) => {
    const r = Number(radarId)
    const rid = Number.isFinite(r) ? r : 0
    const palette = this.#measPalette[rid] || this.#measPalette[0]

    const slot = this.#measSlotIndex(localId)
    return palette[slot] || palette[0]
  }

  #drawMeasurements({ ctx, cx, cy, scale, measurements }) {
    ctx.save()

    for (const m of measurements) {
      const xMm = Number(m.xMm)
      const yMm = Number(m.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      const sx = cx + (yMm * scale)
      const sy = cy - (xMm * scale)

      ctx.fillStyle = this.#measFillStyle(m)

      ctx.beginPath()
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  #parseTrackSeq = (id) => {
    const s = String(id || '')
    const i = s.lastIndexOf(':')
    if (i === -1) return null

    const n = Number(s.slice(i + 1))
    return Number.isFinite(n) ? n : null
  }

  #colorForSeq = (seq, alpha = 0.85) => {
    // golden-angle spacing → perceptually distinct colors
    const hue = (seq * 137.508) % 360
    return `hsla(${hue}, 90%, 55%, ${alpha})`
  }

  #getTrackFillStyle = (t) => {
    const isTentative = String(t.state || '') === 'tentative'
    if (isTentative) return 'rgba(255,200,0,0.85)'

    const seq = this.#parseTrackSeq(t.id)
    if (seq === null) return 'rgba(0,255,160,0.85)'

    let color = this.#trackColorBySeq.get(seq)
    if (color) return color

    // create new color
    color = this.#colorForSeq(seq, 0.85)
    this.#trackColorBySeq.set(seq, color)
    this.#trackColorOrder.push(seq)

    // prune oldest if over limit
    if (this.#trackColorOrder.length > this.#maxTrackColors) {
      const oldSeq = this.#trackColorOrder.shift()
      this.#trackColorBySeq.delete(oldSeq)
    }

    return color
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

  #drawTracks({ ctx, cx, cy, scale, tracks }) {
    const velScale = Number(this.#cfg.draw.velocityArrowScale) || 8

    for (const t of tracks) {
      const xMm = Number(t.xMm)
      const yMm = Number(t.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      const sx = cx + (yMm * scale)
      const sy = cy - (xMm * scale)

      ctx.save()

      ctx.fillStyle = this.#getTrackFillStyle(t)

      // star instead of circle
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
