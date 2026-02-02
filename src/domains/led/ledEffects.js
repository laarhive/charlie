const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const lerp = (a, b, t) => a + (b - a) * t

const ease = (name, t) => {
  if (name === 'inOutSine') return 0.5 - 0.5 * Math.cos(Math.PI * t)
  return t
}

const osc = (name, phase01) => {
  const t = clamp(phase01, 0, 1)

  if (name === 'linear') {
    return t < 0.5 ? (t * 2) : (2 - t * 2)
  }

  if (name === 'inOutSine') {
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * t)
  }

  return 0.5 - 0.5 * Math.cos(2 * Math.PI * t)
}

const getPrimary = (evt) => evt?.payload?.primary || evt?.payload?.targets?.[0] || null

const distanceM = (evt) => {
  const p = getPrimary(evt)
  if (!Array.isArray(p?.xy)) return null
  return Math.hypot(p.xy[0], p.xy[1])
}

const sampleGradient = (stops, t) => {
  const x = clamp(t, 0, 1)
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (x >= a.t && x <= b.t) {
      const u = (x - a.t) / (b.t - a.t)
      return [
        Math.round(lerp(a.rgb[0], b.rgb[0], u)),
        Math.round(lerp(a.rgb[1], b.rgb[1], u)),
        Math.round(lerp(a.rgb[2], b.rgb[2], u)),
      ]
    }
  }
  return stops.at(-1).rgb
}

const resolveRgbValue = (rgbVal, config) => {
  if (typeof rgbVal === 'string') {
    const key = rgbVal.trim()
    const hit = config?.palette?.colors?.[key]?.rgb
    if (Array.isArray(hit) && hit.length >= 3) return hit
    return [0, 0, 0]
  }

  if (Array.isArray(rgbVal) && rgbVal.length >= 3) {
    return rgbVal
  }

  return null
}

export const createEffectRunner = function ({ effectDef, config, initialRgb, requestRef, clockNowMs }) {
  if (effectDef.type === 'frames') {
    let i = 0
    let loops = effectDef.loop === 'inf' ? Infinity : effectDef.loop ?? 1

    return {
      next() {
        if (i >= effectDef.frames.length) {
          loops -= 1
          if (loops <= 0) return { done: true }
          i = 0
        }

        const f = effectDef.frames[i++]
        const rgb = resolveRgbValue(f.rgb, config) || [0, 0, 0]

        return { rgb, nextInMs: f.holdMs, done: false }
      },
    }
  }

  if (effectDef.type === 'fadeTo') {
    const start = clockNowMs
    const target = resolveRgbValue(effectDef.rgb, config) || [0, 0, 0]
    const from = initialRgb

    return {
      next(now) {
        const t = clamp((now - start) / effectDef.ms, 0, 1)
        const u = ease(effectDef.ease, t)
        const rgb = [
          Math.round(lerp(from[0], target[0], u)),
          Math.round(lerp(from[1], target[1], u)),
          Math.round(lerp(from[2], target[2], u)),
        ]

        return t >= 1 ? { rgb, done: true } : { rgb, nextInMs: 20, done: false }
      },
    }
  }

  if (effectDef.type === 'breathe') {
    const start = clockNowMs

    const grad = effectDef.modulators?.color
    const speed = effectDef.modulators?.speed

    const baseFallback = resolveRgbValue(effectDef.rgb, config) || [0, 0, 0]
    const periodFallback = Number.isFinite(effectDef.periodMs) ? effectDef.periodMs : 2400

    return {
      next(now) {
        const evt = requestRef?.sourceEvent || null
        const d = distanceM(evt)

        let rgbBase = baseFallback
        let period = periodFallback

        if (d !== null && grad?.type === 'gradientByDistance') {
          rgbBase = sampleGradient(
            config.palette.gradients[grad.gradient],
            clamp((d - grad.nearM) / (grad.farM - grad.nearM), 0, 1),
          )
        }

        if (d !== null && speed?.type === 'byDistance') {
          period = lerp(
            speed.nearMs,
            speed.farMs,
            clamp((d - speed.nearM) / (speed.farM - speed.nearM), 0, 1),
          )
        }

        const phase = ((now - start) % period) / period
        const u = osc(effectDef.ease, phase)
        const mix = lerp(effectDef.minMix, effectDef.maxMix, u)

        return {
          rgb: rgbBase.map((v) => Math.round(v * mix)),
          nextInMs: 20,
          done: false,
        }
      },
    }
  }

  return { next: () => ({ done: true }) }
}
