import domainEventTypes from '../../domainEventTypes.js'
import { TransformService } from '../transform/transformService.js'

export class Ld2450IngestAdapter {
  #logger
  #clock
  #controllerId

  #presenceBus
  #presenceInternalBus

  #devicesByPublishAs
  #layoutByPublishAs

  #transform
  #cfg

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

    this.#cfg = controllerConfig || {}

    const list = Array.isArray(devices) ? devices : []
    for (const d of list) {
      const publishAs = String(d?.publishAs || '').trim()
      if (!publishAs) continue
      this.#devicesByPublishAs.set(publishAs, d)
    }

    this.#initLayout(this.#cfg)

    this.#transform = new TransformService({
      config: this.#cfg,
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
    const frameTs = Number(frame.ts) || Number(event?.ts) || this.#clock.nowMs()
    const slots = Array.isArray(frame.targets) ? frame.targets : []

    const frameSnapshot = {
      measTs: frameTs,
      bus: 'presence',
      publishAs,
      radarId: layoutEntry.radarId,
      slots: slots.map((t) => ({
        slotId: Number(t?.id),
        valid: t?.valid === true,
        xMm: Number(t?.xMm) || 0,
        yMm: Number(t?.yMm) || 0,
      })),
    }

    const detections = slots
      .filter((t) => t && t.valid === true)
      .map((t) => ({
        slotId: Number(t.id),
        xMm: Number(t.xMm) || 0,
        yMm: Number(t.yMm) || 0,
        speedMmS: Number.isFinite(Number(t.speedCms)) ? Number(t.speedCms) * 10 : 0,
        resolutionMm: Number(t.resolutionMm) || 0,
      }))

    const tracks = detections.map((d) => {
      const local = this.#deriveLocal(d.xMm, d.yMm)

      const worldMeas = this.#transform.toWorldMm({
        radarId: layoutEntry.radarId,
        xMm: d.xMm,
        yMm: d.yMm,
      })

      const world = this.#deriveWorld(worldMeas.xMm, worldMeas.yMm)
      const transformDebug = this.#transform.getDebugForRadar(layoutEntry.radarId)

      return {
        trackId: `${publishAs}:${d.slotId}`,
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

        provenance: {
          bus: 'presence',
          publishAs,
          radarId: layoutEntry.radarId,
          slotId: d.slotId,
          measTs: frameTs,

          localMm: { xMm: d.xMm, yMm: d.yMm },
          worldMeasMm: { xMm: worldMeas.xMm, yMm: worldMeas.yMm },

          transform: transformDebug,

          frame: frameSnapshot,
        },
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
    const bearingDeg = (Math.atan2(yMm, xMm) * 180) / Math.PI
    return { xMm, yMm, rangeMm, bearingDeg }
  }
}

export default Ld2450IngestAdapter
