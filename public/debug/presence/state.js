const emptyStats = function emptyStats() {
  return {
    lastInternalTs: null,
    lastMainTs: null,
    lastRawTs: null,

    measCount: 0,
    trackCount: 0,

    lastLd2450ByRadar: new Map(), // radarId -> { ts, detections }
  }
}

export class PresenceUiState {
  #cfg
  #stats

  #measurements /* world points from presenceInternal:ld2450Tracks */
  #tracks /* global tracks from presenceInternal:globalTracks */

  constructor({ cfg }) {
    this.#cfg = cfg
    this.#stats = emptyStats()

    this.#measurements = []
    this.#tracks = []
  }

  getConfig() {
    return this.#cfg
  }

  getStats() {
    return this.#stats
  }

  getMeasurements() {
    return this.#measurements
  }

  getTracks() {
    return this.#tracks
  }

  ingestBusEvent({ bus, event }) {
    if (!event?.type) return

    if (bus === 'presenceInternal') {
      this.#stats.lastInternalTs = event.ts ?? Date.now()
      this.#onPresenceInternal(event)
      return
    }

    if (bus === 'main') {
      this.#stats.lastMainTs = event.ts ?? Date.now()
      return
    }

    if (bus === 'presence') {
      this.#stats.lastRawTs = event.ts ?? Date.now()
      return
    }
  }

  #onPresenceInternal(event) {
    if (event.type === 'presence:ld2450Tracks') {
      this.#ingestLd2450Tracks(event)
      return
    }

    if (event.type === 'presence:globalTracks') {
      this.#ingestGlobalTracks(event)
      return
    }
  }

  #ingestLd2450Tracks(event) {
    const p = event.payload || {}
    const ts = Number(p.ts) || Date.now()
    const tracks = Array.isArray(p.tracks) ? p.tracks : []
    const meta = p.meta || {}

    // We treat these as “measurements” for visualization
    const points = []

    for (const t of tracks) {
      const w = t?.world || {}
      const xMm = Number(w.xMm)
      const yMm = Number(w.yMm)
      if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) continue

      points.push({
        xMm,
        yMm,
        radarId: Number(t.radarId),
        zoneId: String(t.zoneId || ''),
        ts,
      })
    }

    this.#measurements = points
    this.#stats.measCount = points.length

    const rid = Number(meta.radarId)
    if (Number.isFinite(rid)) {
      this.#stats.lastLd2450ByRadar.set(rid, {
        ts,
        detections: points.length,
        publishAs: meta.publishAs || null,
      })
    }
  }

  #ingestGlobalTracks(event) {
    const p = event.payload || {}
    const ts = Number(p.ts) || Date.now()
    const tracks = Array.isArray(p.tracks) ? p.tracks : []

    this.#tracks = tracks.map((t) => ({
      id: String(t.id || ''),
      state: String(t.state || ''),
      xMm: Number(t.xMm),
      yMm: Number(t.yMm),
      vxMmS: Number(t.vxMmS),
      vyMmS: Number(t.vyMmS),
      speedMmS: Number(t.speedMmS),
      ageMs: Number(t.ageMs),
      lastSeenMs: Number(t.lastSeenMs),
      sourceRadars: Array.isArray(t.sourceRadars) ? t.sourceRadars : [],
      ts,
    }))

    this.#stats.trackCount = this.#tracks.length
  }
}
