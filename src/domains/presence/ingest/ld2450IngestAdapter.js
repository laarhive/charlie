// src/domains/presence/ingest/ld2450IngestAdapter.js
import domainEventTypes from '../../domainEventTypes.js'
import TransformService from '../transform/transformService.js'

const Ld2450IngestAdapter = class Ld2450IngestAdapter {
  #logger
  #clock
  #controllerId

  #presenceBus
  #presenceInternalBus

  #devicesByPublishAs
  #layoutByPublishAs

  #transform

  #unsubscribe

  constructor({ logger, clock, controllerId, presenceBus, presenceInternalBus, controllerConfig, devices }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId || 'presenceController'

    this.#presenceBus = presenceBus
    this.#presenceInternalBus = presenceInternalBus

    this.#devicesByPublishAs = new Map()
    this.#layoutByPublishAs = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const d of list) {
      const publishAs = String(d?.publishAs || '').trim()
      if (!publishAs) continue
      this.#devicesByPublishAs.set(publishAs, d)
    }

    this.#initLayout(controllerConfig || {})

    this.#transform = new TransformService({
      config: controllerConfig || {},
      logger: this.#logger,
    })

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

  #initLayout(cfg) {
    const layout = cfg?.layout || {}
    const list = Array.isArray(layout?.ld2450) ? layout.ld2450 : []

    for (let radarId = 0; radarId < list.length; radarId += 1) {
      const entry = list[radarId]
      const publishAs = String(entry?.publishAs || '').trim()
      if (!publishAs) continue

      const enabled = entry?.enabled === true
      const zoneId = `zone${radarId}`

      this.#layoutByPublishAs.set(publishAs, { publishAs, radarId, zoneId, enabled })
    }
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

    const layoutEntry = this.#layoutByPublishAs.get(publishAs)
    if (!layoutEntry || layoutEntry.enabled !== true) {
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
      const local = this.#deriveLocal(d.xMm, d.yMm)

      const worldXY = this.#transform.toWorldMm({
        radarId: layoutEntry.radarId,
        xMm: d.xMm,
        yMm: d.yMm,
      })

      const world = this.#deriveWorld(worldXY.xMm, worldXY.yMm)

      return {
        trackId: `${publishAs}:${d.localId}`,
        state: 'confirmed',

        radarId: layoutEntry.radarId,
        zoneId: layoutEntry.zoneId,

        local: {
          xMm: d.xMm,
          yMm: d.yMm,
          rangeMm: local.rangeMm,
          bearingDeg: local.bearingDeg,
        },

        world: {
          xMm: world.xMm,
          yMm: world.yMm,
          rangeMm: world.rangeMm,
          bearingDeg: world.bearingDeg,
        },

        vxMmS: 0,
        vyMmS: 0,

        speedMmS: Math.abs(d.speedMmS),

        ageMs: 0,
        lastSeenMs: 0,
        sourceRadars: [layoutEntry.radarId],
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
          radarId: layoutEntry.radarId,
          zoneId: layoutEntry.zoneId,
          slotCount: slots.length,
          detectionCount: detections.length,
          frame: 'radarLocal_to_world_v0',
        },
      },
    })
  }

  #deriveLocal(xMm, yMm) {
    const rangeMm = Math.sqrt((xMm * xMm) + (yMm * yMm))
    const bearingDeg = (Math.atan2(xMm, yMm) * 180) / Math.PI
    return { rangeMm, bearingDeg }
  }

  #deriveWorld(xMm, yMm) {
    const rangeMm = Math.sqrt((xMm * xMm) + (yMm * yMm))

    // world frame:
    // +X = North, +Y = East
    // bearing clockwise from North: atan2(Y, X)
    const bearingDeg = (Math.atan2(yMm, xMm) * 180) / Math.PI

    return { xMm, yMm, rangeMm, bearingDeg }
  }
}

export default Ld2450IngestAdapter
export { Ld2450IngestAdapter }
