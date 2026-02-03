// src/domains/led/ledEffects.js
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

const resolveRgbValue = function (rgbVal, config) {
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

const createFadeRunner = function ({ from, to, ms, easeName, startMs }) {
  const duration = Math.max(0, Math.floor(Number(ms || 0)))
  const easing = easeName || 'linear'

  return {
    next(nowMs) {
      if (duration === 0) {
        return { rgb: to, done: true }
      }

      const t = clamp((nowMs - startMs) / duration, 0, 1)
      const u = ease(easing, t)

      const rgb = [
        Math.round(lerp(from[0], to[0], u)),
        Math.round(lerp(from[1], to[1], u)),
        Math.round(lerp(from[2], to[2], u)),
      ]

      return t >= 1 ? { rgb, done: true } : { rgb, nextInMs: 20, done: false }
    },
  }
}

export const createEffectRunner = function ({ effectDef, config, initialRgb, sourceEvent, clockNowMs }) {
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

    const runner = createFadeRunner({
      from,
      to: target,
      ms: effectDef.ms,
      easeName: effectDef.ease,
      startMs: start,
    })

    return {
      next(now) {
        return runner.next(now)
      },
    }
  }

  if (effectDef.type === 'breathe') {
    const start = clockNowMs
    const d = distanceM(sourceEvent)

    const grad = effectDef.modulators?.color
    const speed = effectDef.modulators?.speed

    const baseFallback = resolveRgbValue(effectDef.rgb, config) || [0, 0, 0]
    const periodFallback = Number.isFinite(effectDef.periodMs) ? effectDef.periodMs : 2400

    const rgbBase = d !== null && grad?.type === 'gradientByDistance'
      ? sampleGradient(
        config.palette.gradients[grad.gradient],
        clamp((d - grad.nearM) / (grad.farM - grad.nearM), 0, 1),
      )
      : baseFallback

    const period = d !== null && speed?.type === 'byDistance'
      ? lerp(
        speed.nearMs,
        speed.farMs,
        clamp((d - speed.nearM) / (speed.farM - speed.nearM), 0, 1),
      )
      : periodFallback

    return {
      next(now) {
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

  if (effectDef.type === 'sequence') {
    const steps = Array.isArray(effectDef.steps) ? effectDef.steps : []
    let idx = 0
    let loops = effectDef.loop === 'inf' ? Infinity : effectDef.loop ?? 1

    let currentRgb = Array.isArray(initialRgb) ? initialRgb : [0, 0, 0]
    let activeFade = null

    const advanceLoopIfNeeded = function () {
      if (idx < steps.length) return true

      loops -= 1
      if (loops <= 0) return false

      idx = 0
      return true
    }

    return {
      next(now) {
        let guard = 0

        while (guard < 16) {
          guard += 1

          if (!advanceLoopIfNeeded()) {
            return { done: true }
          }

          if (steps.length === 0) {
            return { done: true }
          }

          if (activeFade) {
            const r = activeFade.next(now)
            if (r?.rgb) currentRgb = r.rgb

            if (r?.done) {
              activeFade = null
              idx += 1
              continue
            }

            return r
          }

          const s = steps[idx] || {}
          const op = String(s.op || '').trim()

          if (op === 'hold') {
            const ms = Math.max(0, Math.floor(Number(s.ms || 0)))
            idx += 1

            if (ms === 0) continue
            return { nextInMs: ms, done: false }
          }

          if (op === 'fadeTo') {
            const to = resolveRgbValue(s.rgb, config) || [0, 0, 0]
            const ms = Math.max(0, Math.floor(Number(s.ms || 0)))
            const easeName = s.ease || 'linear'

            activeFade = createFadeRunner({
              from: currentRgb,
              to,
              ms,
              easeName,
              startMs: now,
            })

            continue
          }

          return { done: true }
        }

        return { done: true }
      },
    }
  }

  return { next: () => ({ done: true }) }
}
