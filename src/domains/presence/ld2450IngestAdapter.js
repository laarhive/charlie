// src/domains/presence/ld2450IngestAdapter.js
import domainEventTypes from '../domainEventTypes.js'

export class Ld2450IngestAdapter {
  #logger
  #clock
  #controllerId

  #presenceBus
  #presenceInternalBus

  #devicesByPublishAs
  #unsubscribe

  constructor({ logger, clock, controllerId, presenceBus, presenceInternalBus, devices }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId || 'presenceController'

    this.#presenceBus = presenceBus
    this.#presenceInternalBus = presenceInternalBus

    this.#devicesByPublishAs = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const d of list) {
      const publishAs = String(d?.publishAs || '').trim()
      if (!publishAs) continue
      this.#devicesByPublishAs.set(publishAs, d)
    }

    if (!this.#presenceBus?.subscribe) {
      throw new Error('Ld2450IngestAdapter requires presenceBus.subscribe')
    }

    if (!this.#presenceInternalBus?.publish) {
      throw new Error('Ld2450IngestAdapter requires presenceInternalBus.publish')
    }
  }

  start() {
    if (this.#unsubscribe) return

    this.#unsubscribe = this.#presenceBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.presence.ld2450) return
      this.#onLd2450Raw(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) return
    this.#unsubscribe()
    this.#unsubscribe = null
  }

  #deviceUsable(device) {
    if (!device) return false
    if (device.enabled === false) return false
    return String(device.state || 'active') === 'active'
  }

  #onLd2450Raw(event) {
    const p = event?.payload || {}
    const publishAs = String(p.publishAs || '').trim()
    if (!publishAs) return

    const device = this.#devicesByPublishAs.get(publishAs)
    if (!this.#deviceUsable(device)) {
      return
    }

    const frame = p.frame || {}
    const frameTs = Number(frame.ts) || this.#clock.nowMs()
    const slots = Array.isArray(frame.targets) ? frame.targets : []

    const detections = slots
      .filter((t) => t && t.valid === true)
      .map((t) => ({
        localId: t.id,
        xMm: Number(t.xMm) || 0,
        yMm: Number(t.yMm) || 0,
        speedMmS: Number.isFinite(Number(t.speedCms)) ? Number(t.speedCms) * 10 : 0,
        resolutionMm: Number(t.resolutionMm) || 0,
      }))

    const tracks = detections.map((d) => {
      const xMm = d.xMm
      const yMm = d.yMm

      const rangeMm = Math.sqrt((xMm * xMm) + (yMm * yMm))
      const bearingDeg = (Math.atan2(xMm, yMm) * 180) / Math.PI

      return {
        trackId: `${publishAs}:${d.localId}`,
        state: 'confirmed',

        xMm,
        yMm,
        vxMmS: 0,
        vyMmS: 0,

        rangeMm,
        bearingDeg,
        speedMmS: Math.abs(d.speedMmS),

        ageMs: 0,
        lastSeenMs: 0,
        sourceRadars: [],
      }
    })

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.ld2450Tracks,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: {
        ts: frameTs,
        tracks,
        slots,

        meta: {
          publishAs,
          slotCount: slots.length,
          detectionCount: detections.length,
          frame: 'radarLocal_placeholder',
        },
      },
    })
  }
}

export default Ld2450IngestAdapter
