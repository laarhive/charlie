import JSON5 from '/vendor/json5/index.min.mjs'

const deepMerge = function deepMerge(dst, src) {
  if (!src) return dst

  for (const k of Object.keys(src)) {
    const v = src[k]

    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      dst[k] ??= {}
      deepMerge(dst[k], v)
    } else {
      dst[k] = v
    }
  }

  return dst
}

const fetchJson5 = async function fetchJson5(path) {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) return null
  const text = await res.text()
  return JSON5.parse(text)
}

const fetchServerConfig = async function fetchServerConfig(path) {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) return null

  const json = await res.json()
  if (!json?.ok || !json.data) return null
  return json.data
}

export const loadUiConfig = async function loadPresenceUiConfig() {
  // 1) local json5 (defines paths)
  const localCfg = await fetchJson5('config.json5')
  if (!localCfg) throw new Error('failed to load radar config.json5')

  const cfg = structuredClone(localCfg)

  // 2) server config
  const serverCfg = await fetchServerConfig(cfg.srvConfigPath)
  if (serverCfg) {
    // adjust this path once, centrally
    const serverPresence = serverCfg?.controllers?.presence
    if (serverPresence) {
      cfg.presence ??= {}
      deepMerge(cfg.presence, serverPresence)
    }
  }

  // 3) local overrides win
  deepMerge(cfg.presence, localCfg.presence)

  return cfg
}
