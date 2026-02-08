import fs from 'node:fs/promises'
import path from 'node:path'
import JSON5 from 'json5'

import { validateRecording, normalizeRecordingPath } from './recordingFormat.js'
import { formatRecording } from './recordingFormatter.js'
import { formattersByRawType } from './formattersByRawType.js'

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
      extrasPolicy: 'append',   // 'append' | 'omit' | 'comment'
      verifyRoundTrip: true
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
