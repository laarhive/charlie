// src/domains/led/ledValidate.js
const isObject = function (x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

const asArray = function (x) {
  return Array.isArray(x) ? x : []
}

const asObject = function (x) {
  return isObject(x) ? x : {}
}

const asString = function (x) {
  return String(x ?? '').trim()
}

const toBool = function (x, def) {
  if (x === undefined) return def
  return Boolean(x)
}

const toNonNegIntOrNull = function (x) {
  if (x === null || x === undefined) return null
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

const toNonNegInt = function (x, def) {
  if (x === undefined) return def
  const n = Number(x)
  if (!Number.isFinite(n)) return def
  return Math.max(0, Math.floor(n))
}

const clampByte = function (x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(255, Math.round(n)))
}

const clamp01 = function (x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

const validateRgbArray = function (rgb, ctx) {
  if (!Array.isArray(rgb) || rgb.length < 3) {
    throw new Error(`${ctx}: rgb must be [r,g,b]`)
  }

  return [
    clampByte(rgb[0]),
    clampByte(rgb[1]),
    clampByte(rgb[2]),
  ]
}

const validateRgbValue = function ({ rgb, paletteColors, ctx }) {
  if (typeof rgb === 'string') {
    const key = rgb.trim()
    if (!key) throw new Error(`${ctx}: rgb string must be non-empty`)
    if (!paletteColors?.[key]) {
      throw new Error(`${ctx}: unknown rgb '${key}' (not found in palette.colors)`)
    }

    return key
  }

  if (Array.isArray(rgb)) {
    return validateRgbArray(rgb, ctx)
  }

  throw new Error(`${ctx}: rgb must be a color name string or [r,g,b]`)
}

const validateGradientStops = function (name, stops) {
  const list = asArray(stops)
  if (list.length < 2) {
    throw new Error(`palette.gradients.${name}: requires at least 2 stops`)
  }

  const out = []

  for (let i = 0; i < list.length; i += 1) {
    const s = list[i]
    if (!isObject(s)) throw new Error(`palette.gradients.${name}[${i}]: stop must be object`)

    const t = Number(s.t)
    if (!Number.isFinite(t)) throw new Error(`palette.gradients.${name}[${i}]: t must be number`)

    const rgb = validateRgbArray(s.rgb, `palette.gradients.${name}[${i}]`)
    out.push({ t: clamp01(t), rgb })
  }

  out.sort((a, b) => a.t - b.t)
  return out
}

const normalizeLoop = function (loop) {
  if (loop === undefined) return undefined
  if (loop === true) return 'inf'
  if (loop === 'inf') return 'inf'

  const n = Number(loop)
  if (Number.isFinite(n)) {
    return Math.max(1, Math.floor(n))
  }

  throw new Error(`effects.*.loop: must be true|'inf'|N`)
}

const validateEffectFrames = function ({ effectName, eff, paletteColors }) {
  const frames = asArray(eff.frames)
  if (frames.length === 0) {
    throw new Error(`effects.${effectName}: frames effect requires frames[]`)
  }

  const outFrames = frames.map((f, idx) => {
    const fo = asObject(f)

    if (fo.rgb === undefined) {
      throw new Error(`effects.${effectName}.frames[${idx}]: requires rgb`)
    }

    const rgbVal = validateRgbValue({
      rgb: fo.rgb,
      paletteColors,
      ctx: `effects.${effectName}.frames[${idx}]`,
    })

    const holdMs = toNonNegInt(fo.holdMs, 0)

    return {
      rgb: rgbVal,
      holdMs,
    }
  })

  const loop = normalizeLoop(eff.loop)

  const out = {
    type: 'frames',
    frames: outFrames,
  }

  if (loop !== undefined) out.loop = loop

  return out
}

const validateEffectFadeTo = function ({ effectName, eff, paletteColors }) {
  const o = asObject(eff)

  if (o.rgb === undefined) {
    throw new Error(`effects.${effectName}: fadeTo requires rgb`)
  }

  const rgbVal = validateRgbValue({
    rgb: o.rgb,
    paletteColors,
    ctx: `effects.${effectName}`,
  })

  const ms = toNonNegInt(o.ms, 0)
  const ease = asString(o.ease) || 'linear'

  return {
    type: 'fadeTo',
    ms,
    ease,
    rgb: rgbVal,
    loop: undefined,
  }
}

const validateEffectBreathe = function ({ effectName, eff, paletteColors, paletteGradients }) {
  const o = asObject(eff)

  const minMix = clamp01(o.minMix ?? 0.15)
  const maxMix = clamp01(o.maxMix ?? 1.0)

  const ease = asString(o.ease) || 'inOutSine'
  const periodMs = o.periodMs !== undefined ? Math.max(50, toNonNegInt(o.periodMs, 2400)) : undefined

  const mods = asObject(o.modulators)

  const colorMod = asObject(mods.color)
  const speedMod = asObject(mods.speed)

  const outMods = {}

  if (asString(colorMod.type) === 'gradientByDistance') {
    const gradient = asString(colorMod.gradient)
    if (!gradient) throw new Error(`effects.${effectName}.modulators.color: gradientByDistance requires gradient`)
    if (!paletteGradients?.[gradient]) throw new Error(`effects.${effectName}.modulators.color: unknown gradient '${gradient}'`)

    const nearM = Number(colorMod.nearM)
    const farM = Number(colorMod.farM)
    if (!Number.isFinite(nearM) || !Number.isFinite(farM) || nearM === farM) {
      throw new Error(`effects.${effectName}.modulators.color: invalid nearM/farM`)
    }

    outMods.color = { type: 'gradientByDistance', gradient, nearM, farM }
  }

  if (asString(speedMod.type) === 'byDistance') {
    const nearM = Number(speedMod.nearM)
    const farM = Number(speedMod.farM)
    if (!Number.isFinite(nearM) || !Number.isFinite(farM) || nearM === farM) {
      throw new Error(`effects.${effectName}.modulators.speed: invalid nearM/farM`)
    }

    const nearMs = toNonNegInt(speedMod.nearMs, 900)
    const farMs = toNonNegInt(speedMod.farMs, 2800)

    outMods.speed = { type: 'byDistance', nearM, farM, nearMs, farMs }
  }

  if (o.rgb === undefined) {
    throw new Error(`effects.${effectName}: breathe requires rgb (fallback)`)
  }

  const rgbVal = validateRgbValue({
    rgb: o.rgb,
    paletteColors,
    ctx: `effects.${effectName}`,
  })

  const out = {
    type: 'breathe',
    minMix,
    maxMix,
    ease,
    rgb: rgbVal,
  }

  if (periodMs !== undefined) out.periodMs = periodMs
  if (Object.keys(outMods).length > 0) out.modulators = outMods

  return out
}

const validateEffectSequence = function ({ effectName, eff, paletteColors }) {
  const o = asObject(eff)

  const steps = asArray(o.steps)
  if (steps.length === 0) {
    throw new Error(`effects.${effectName}: sequence requires steps[]`)
  }

  const outSteps = steps.map((s, idx) => {
    const so = asObject(s)
    const op = asString(so.op)

    if (op === 'hold') {
      return {
        op: 'hold',
        ms: toNonNegInt(so.ms, 0),
      }
    }

    if (op === 'fadeTo') {
      if (so.rgb === undefined) {
        throw new Error(`effects.${effectName}.steps[${idx}]: fadeTo requires rgb`)
      }

      const rgbVal = validateRgbValue({
        rgb: so.rgb,
        paletteColors,
        ctx: `effects.${effectName}.steps[${idx}]`,
      })

      return {
        op: 'fadeTo',
        rgb: rgbVal,
        ms: toNonNegInt(so.ms, 0),
        ease: asString(so.ease) || 'linear',
      }
    }

    throw new Error(`effects.${effectName}.steps[${idx}]: unknown op '${op}'`)
  })

  const loop = normalizeLoop(o.loop)

  const out = {
    type: 'sequence',
    steps: outSteps,
  }

  if (loop !== undefined) out.loop = loop

  return out
}

const validateEffects = function ({ effectsRaw, palette }) {
  const effects = asObject(effectsRaw)
  const out = {}

  const paletteColors = asObject(palette?.colors)
  const paletteGradients = asObject(palette?.gradients)

  for (const [nameRaw, effRaw] of Object.entries(effects)) {
    const effectName = asString(nameRaw)
    if (!effectName) continue

    const eff = asObject(effRaw)
    const type = asString(eff.type)

    if (!type) throw new Error(`effects.${effectName}: missing type`)

    if (type === 'frames') {
      out[effectName] = validateEffectFrames({ effectName, eff, paletteColors })
      continue
    }

    if (type === 'fadeTo') {
      out[effectName] = validateEffectFadeTo({ effectName, eff, paletteColors })
      continue
    }

    if (type === 'breathe') {
      out[effectName] = validateEffectBreathe({ effectName, eff, paletteColors, paletteGradients })
      continue
    }

    if (type === 'sequence') {
      out[effectName] = validateEffectSequence({ effectName, eff, paletteColors })
      continue
    }

    throw new Error(`effects.${effectName}: unknown type '${type}'`)
  }

  return out
}

const validatePalette = function (paletteRaw) {
  const palette = asObject(paletteRaw)
  const colorsRaw = asObject(palette.colors)
  const gradientsRaw = asObject(palette.gradients)

  const colors = {}
  for (const [nameRaw, cRaw] of Object.entries(colorsRaw)) {
    const name = asString(nameRaw)
    if (!name) continue

    const c = asObject(cRaw)
    colors[name] = { rgb: validateRgbArray(c.rgb, `palette.colors.${name}`) }
  }

  const gradients = {}
  for (const [nameRaw, stops] of Object.entries(gradientsRaw)) {
    const name = asString(nameRaw)
    if (!name) continue
    gradients[name] = validateGradientStops(name, stops)
  }

  return { colors, gradients }
}

const validateTargets = function (targetsRaw) {
  const targets = asObject(targetsRaw)
  const aliasRaw = asObject(targets.alias)

  const alias = {}
  for (const [nameRaw, entryRaw] of Object.entries(aliasRaw)) {
    const name = asString(nameRaw)
    if (!name) continue

    const entry = asObject(entryRaw)
    const ledId = asString(entry.ledId)
    if (!ledId) throw new Error(`targets.alias.${name}: missing ledId`)

    alias[name] = { ledId }
  }

  return { alias }
}

const validateWhen = function (whenRaw) {
  const w = asObject(whenRaw)
  const out = {}

  if (w.coreRole !== undefined) out.coreRole = asString(w.coreRole)

  if (w.hasTarget !== undefined) {
    out.hasTarget = Boolean(w.hasTarget)
  }

  return Object.keys(out).length > 0 ? out : undefined
}

const validateTargetSelector = function ({ targetRaw, targets }) {
  const t = asObject(targetRaw)

  const ledId = asString(t.ledId)
  if (ledId) return { ledId }

  const alias = asString(t.alias)
  if (alias) {
    const entry = targets?.alias?.[alias]
    if (!entry?.ledId) throw new Error(`target.alias '${alias}' not found in targets.alias`)
    return { ledId: entry.ledId }
  }

  throw new Error(`rule target requires ledId or alias`)
}

const validateDo = function ({ doRaw, effects }) {
  const d = asObject(doRaw)
  const effect = asString(d.effect)
  if (!effect) throw new Error(`rule.do.effect missing`)
  if (!effects[effect]) throw new Error(`rule.do.effect '${effect}' not found in effects`)

  const priority = Number.isFinite(Number(d.priority)) ? Number(d.priority) : 0
  const restore = Boolean(d.restore)

  const ttlMs = toNonNegIntOrNull(d.ttlMs)

  const interrupt = asString(d.interrupt) || 'ifLower'
  if (interrupt !== 'always' && interrupt !== 'ifLower' && interrupt !== 'never') {
    throw new Error(`rule.do.interrupt must be 'always'|'ifLower'|'never'`)
  }

  const out = { effect, priority, restore, ttlMs, interrupt }

  if (d.params !== undefined) out.params = d.params

  return out
}

const validateRules = function ({ rulesRaw, targets, effects }) {
  const list = asArray(rulesRaw)

  return list.map((r, idx) => {
    const rule = asObject(r)

    const on = asString(rule.on)
    if (!on) throw new Error(`rules[${idx}]: missing on`)

    const when = validateWhen(rule.when)
    const target = validateTargetSelector({ targetRaw: rule.target, targets })
    const d = validateDo({ doRaw: rule.do, effects })

    return {
      on,
      when,
      target,
      do: d,
    }
  })
}

export const validateLedConfig = function ({ config, logger }) {
  const raw = asObject(config)
  const enabled = toBool(raw.enabled, true)

  const out = {
    enabled,
    targets: validateTargets(raw.targets),
    palette: validatePalette(raw.palette),
    effects: {},
    rules: [],
  }

  try {
    out.effects = validateEffects({ effectsRaw: raw.effects, palette: out.palette })
    out.rules = validateRules({ rulesRaw: raw.rules, targets: out.targets, effects: out.effects })
  } catch (e) {
    logger?.error?.('led_config_invalid', { message: String(e?.message || e) })
    throw e
  }

  return out
}

export default validateLedConfig
