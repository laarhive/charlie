// src/recording/recordingStore.js
import fs from 'node:fs/promises'
import path from 'node:path'
import JSON5 from 'json5'

import { validateRecording, normalizeRecordingPath } from './recordingFormat.js'
import { formatRecording } from './recordingFormatter.js'
import { formattersByRawType } from './formattersByRawType.js'
import { coalesce } from '../utils/coalesce.js'

export class RecordingStore {
  #baseDir
  #logger

  constructor({ baseDir, logger }) {
    this.#baseDir = String(baseDir || './recordings')
    this.#logger = logger
  }

  getBaseDir() {
    return this.#baseDir
  }

  async ensureBaseDir() {
    const dir = path.resolve(this.#baseDir)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  #ensureExt(nameOrPath) {
    const s = String(nameOrPath || '').trim()
    if (!s) return s
    return s.endsWith('.json5') ? s : `${s}.json5`
  }

  async nextRecordingCounter() {
    const base = await this.ensureBaseDir()
    let files

    try {
      files = await fs.readdir(base)
    } catch (e) {
      this.#logger?.warning?.('recording_readdir_failed', { error: e?.message || String(e) })
      files = []
    }

    let max = 0
    for (const f of files) {
      const m = /^(\d+)-/.exec(String(f || ''))
      if (!m) continue

      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0) continue

      if (n > max) max = n
    }

    const next = max + 1
    const width = next < 100 ? 2 : String(next).length
    return String(next).padStart(width, '0')
  }

  async findLastRecordingByCounter({ fileNameBase, outBase } = {}) {
    const base = await this.ensureBaseDir()

    const ob = String(coalesce(fileNameBase, outBase, '')).trim()
    if (!ob) {
      return { ok: false, error: 'missing_fileNameBase' }
    }

    let files
    try {
      files = await fs.readdir(base)
    } catch (e) {
      return { ok: false, error: 'readdir_failed', detail: e?.message || String(e) }
    }

    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^(\\d+)-${esc(ob)}-(\\d{6}-\\d{6})(?:-.+)?\\.json5$`, 'i')

    let best = null
    for (const f of files) {
      const m = re.exec(String(f || ''))
      if (!m) continue

      const n = Number(m[1])
      if (!Number.isFinite(n)) continue

      if (!best || n > best.n) {
        best = { n, file: f }
      }
    }

    if (!best) return { ok: false, error: 'not_found' }

    const safePath = normalizeRecordingPath({ baseDir: base, nameOrPath: best.file })
    return { ok: true, path: safePath, counter: best.n, file: best.file }
  }

  async save({ filename, recording }) {
    const v = validateRecording(recording)
    if (!v.ok) {
      const err = new Error(v.message || v.error || 'invalid_recording')
      err.code = v.error || 'INVALID_RECORDING'
      throw err
    }

    const base = await this.ensureBaseDir()

    const rawName = String(filename || '').trim()
    if (!rawName) {
      const err = new Error('missing_filename')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const name = this.#ensureExt(rawName)
    const safePath = normalizeRecordingPath({ baseDir: base, nameOrPath: name })

    const body = formatRecording({
      rec: recording,
      formattersByRawType,
      logger: this.#logger,
      verifyRoundTrip: true,
    })

    await fs.writeFile(safePath, body, 'utf8')
    return { ok: true, path: safePath }
  }

  async load({ nameOrPath }) {
    const base = await this.ensureBaseDir()

    const raw = String(nameOrPath || '').trim()
    if (!raw) {
      const err = new Error('missing_path')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const candidate = this.#ensureExt(raw)
    const safePath = normalizeRecordingPath({ baseDir: base, nameOrPath: candidate })

    const body = await fs.readFile(safePath, 'utf8')
    const parsed = JSON5.parse(body)

    const v = validateRecording(parsed)
    if (!v.ok) {
      const err = new Error(v.message || v.error || 'invalid_recording')
      err.code = v.error || 'INVALID_RECORDING'
      throw err
    }

    return { ok: true, path: safePath, recording: parsed }
  }
}

export default RecordingStore
