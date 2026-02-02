import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.resolve(__dirname, '../..')
const configRoot = path.resolve(projectRoot, 'config')

export const resolveConfigPath = function resolveConfigPath(filename, { baseDir } = {}) {
  if (!filename) return null

  if (path.isAbsolute(filename)) return filename

  const base = baseDir || configRoot
  return path.resolve(base, filename)
}

const isPlainObject = function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

const deepMerge = function deepMerge(target, source) {
  if (source === null) return null

  if (Array.isArray(source)) return source
  if (!isPlainObject(source)) return source

  if (!isPlainObject(target)) target = {}

  for (const [k, v] of Object.entries(source)) {
    if (v === null) {
      target[k] = null
      continue
    }

    if (Array.isArray(v)) {
      target[k] = v
      continue
    }

    if (isPlainObject(v)) {
      target[k] = deepMerge(target[k], v)
      continue
    }

    target[k] = v
  }

  return target
}

const setAtPath = function setAtPath(obj, pathParts, value) {
  let cur = obj
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const k = pathParts[i]
    if (!isPlainObject(cur[k])) cur[k] = {}
    cur = cur[k]
  }

  const leaf = pathParts[pathParts.length - 1]
  cur[leaf] = deepMerge(cur[leaf], value)
}

const loadJson5File = function loadJson5File(fullPath) {
  if (!fs.existsSync(fullPath)) {
    throw new Error(`config file not found: ${fullPath}`)
  }

  const raw = fs.readFileSync(fullPath, 'utf8')
  return JSON5.parse(raw)
}

const walkIncludes = function walkIncludes(node, currentPathParts, out) {
  if (typeof node === 'string') {
    out.push({ pathParts: currentPathParts, relFile: node })
    return
  }

  if (!isPlainObject(node)) {
    throw new Error(`invalid include entry at ${currentPathParts.join('.') || '(root)'}`)
  }

  for (const [k, v] of Object.entries(node)) {
    walkIncludes(v, [...currentPathParts, k], out)
  }
}

const filterAndStripDevicesByMode = function filterAndStripDevicesByMode(config, mode) {
  const devices = Array.isArray(config?.devices) ? config.devices : []

  const wantMode = String(mode || '').trim()
  if (!wantMode) {
    return []
  }

  const filtered = []

  for (const d of devices) {
    const modes = Array.isArray(d?.modes) ? d.modes : []
    if (modes.length === 0) continue
    if (!modes.includes(wantMode)) continue

    const out = { ...d }
    delete out.modes

    filtered.push(out)
  }

  return filtered
}

/**
 * Loads config/defaultConfig.json5, resolves keyed includes, and returns one config object.
 *
 * @example
 * const config = loadConfigFile('defaultConfig.json5', { mode: 'rpi4' })
 */
export const loadConfigFile = function loadConfigFile(entry = 'defaultConfig.json5', { mode } = {}) {
  const entryPath = resolveConfigPath(entry, { baseDir: configRoot })
  const rootConfig = loadJson5File(entryPath)

  const includeSpec = rootConfig?.include || {}
  const includeList = []

  walkIncludes(includeSpec, [], includeList)

  let result = {}

  for (const item of includeList) {
    const full = resolveConfigPath(item.relFile, { baseDir: path.dirname(entryPath) })
    const cfg = loadJson5File(full)
    setAtPath(result, item.pathParts, cfg)
  }

  const rootWithoutInclude = { ...rootConfig }
  delete rootWithoutInclude.include

  result = deepMerge(result, rootWithoutInclude)

  result.devices = filterAndStripDevicesByMode(result, mode)

  return result
}

export default loadConfigFile
