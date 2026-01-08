// src/app/configLoader.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.resolve(__dirname, '../..')

/**
 * Resolves a config filename relative to the project root /config directory,
 * with fallback to project root.
 *
 * @example
 * const full = resolveConfigPath('defaultConfig.json5')
 */
export const resolveConfigPath = function resolveConfigPath(filename) {
  if (!filename) {
    return null
  }

  if (path.isAbsolute(filename)) {
    return filename
  }

  const fromConfigDir = path.resolve(projectRoot, 'config', filename)

  if (fs.existsSync(fromConfigDir)) {
    return fromConfigDir
  }

  return path.resolve(projectRoot, filename)
}

/**
 * Loads JSON/JSON5 config file.
 *
 * @example
 * const { fullPath, config } = loadConfigFile('defaultConfig.json5')
 */
export const loadConfigFile = function loadConfigFile(filename) {
  const fullPath = resolveConfigPath(filename)
  const raw = fs.readFileSync(fullPath, 'utf8')
  const ext = path.extname(fullPath).toLowerCase()

  if (ext === '.json5') {
    return { fullPath, config: JSON5.parse(raw) }
  }

  if (ext === '.json') {
    return { fullPath, config: JSON.parse(raw) }
  }

  throw new Error(`unsupported config extension: ${ext}`)
}

export default loadConfigFile
