// src/cli/cliPaths.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const projectRoot = path.resolve(__dirname, '../..')

export const normalizeConfigRelPath = (p) => {
  const raw = String(p || '').trim()
  if (!raw) return null

  if (raw.startsWith('\\\\')) return raw
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw

  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return raw.replace(/^[\\/]+/, '')
  }

  return raw
}

export const resolveFromProjectRoot = (p) => {
  const v = normalizeConfigRelPath(p)
  if (!v) return null

  if (path.isAbsolute(v)) return v
  return path.resolve(projectRoot, v)
}

export default {
  projectRoot,
  normalizeConfigRelPath,
  resolveFromProjectRoot,
}
