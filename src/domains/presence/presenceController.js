// src/domains/presence/presenceController.js
import eventTypes from '../../core/eventTypes.js'
import domainEventTypes from '../domainEventTypes.js'
import { Ld2450IngestAdapter } from './ingest/ld2450IngestAdapter.js'
import { Ld2410IngestAdapter } from './ingest/ld2410IngestAdapter.js'
import { TrackingPipeline } from './tracking/trackingPipeline.js'
import { makeStreamKey } from '../../core/eventBus.js'
import { busIds } from '../../app/buses.js'

export class PresenceController {
  #logger
  #clock
  #controllerId

  #presenceBus
  #presenceInternalBus
  #mainBus

  #config
  #enabled

  #devices

  #ld2450
  #ld2410
  #tracking

  #unsubGlobal

  #lastHealthPublishTs

  constructor({ logger, presenceInternalBus, presenceBus, mainBus, clock, controllerId, controller, devices }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId || 'presenceController'

    this.#presenceInternalBus = presenceInternalBus
    this.#presenceBus = presenceBus
    this.#mainBus = mainBus

    this.#config = controller || {}
    this.#enabled = this.#config?.enabled !== false

    this.#devices = Array.isArray(devices) ? devices : []

    this.#ld2450 = null
    this.#ld2410 = null
    this.#tracking = null
    this.#unsubGlobal = null

    this.#lastHealthPublishTs = 0

    if (!this.#presenceInternalBus?.publish || !this.#presenceInternalBus?.subscribe) {
      throw new Error('presenceController requires presenceInternalBus.publish+subscribe')
    }

    if (!this.#presenceBus?.subscribe) {
      throw new Error('presenceController requires presenceBus.subscribe')
    }

    if (!this.#mainBus?.publish) {
      throw new Error('presenceController requires mainBus.publish')
    }
  }

  get streamKeyWho() { return this.#controllerId }

  start() {
    if (!this.#enabled) {
      this.#logger.notice('presence_controller_disabled', { controllerId: this.#controllerId })
      return
    }

    if (this.#ld2450 || this.#ld2410 || this.#tracking || this.#unsubGlobal) {
      return
    }

    this.#ld2450 = new Ld2450IngestAdapter({
      logger: this.#logger,
      clock: this.#clock,
      controllerId: this.#controllerId,
      presenceBus: this.#presenceBus,
      presenceInternalBus: this.#presenceInternalBus,
      controllerConfig: this.#config,
      devices: this.#devices,
    })

    this.#ld2410 = new Ld2410IngestAdapter({
      logger: this.#logger,
      clock: this.#clock,
      controllerId: this.#controllerId,
      presenceBus: this.#presenceBus,
      presenceInternalBus: this.#presenceInternalBus,
      controllerConfig: this.#config,
      devices: this.#devices,
    })

    this.#tracking = new TrackingPipeline({
      logger: this.#logger,
      clock: this.#clock,
      controllerId: this.#controllerId,
      presenceInternalBus: this.#presenceInternalBus,
      controllerConfig: this.#config,
    })

    this.#ld2450.start()
    this.#ld2410.start()
    this.#tracking.start()

    this.#unsubGlobal = this.#presenceInternalBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.presence.globalTracks) return
      this.#publishTargetsFromGlobalTracks(event)
    })

    this.#logger.notice('presence_controller_started', { controllerId: this.#controllerId })
  }

  dispose() {
    if (this.#unsubGlobal) {
      this.#unsubGlobal()
      this.#unsubGlobal = null
    }

    if (this.#tracking) {
      this.#tracking.dispose()
      this.#tracking = null
    }

    if (this.#ld2450) {
      this.#ld2450.dispose()
      this.#ld2450 = null
    }

    if (this.#ld2410) {
      this.#ld2410.dispose()
      this.#ld2410 = null
    }

    this.#lastHealthPublishTs = 0

    this.#logger.notice('presence_controller_disposed', { controllerId: this.#controllerId })
  }

  #debugEnabled() {
    return this.#config?.debug?.enabled === true
  }

  #publishTargetsFromGlobalTracks(event) {
    const p = event?.payload || {}
    const tracks = Array.isArray(p.tracks) ? p.tracks : []
    const meta = p?.meta || null
    const debugEnabled = this.#debugEnabled()

    const out = tracks
      .filter((t) => t && t.state === 'confirmed')
      .map((t) => {
        const item = {
          id: t.id,

          xMm: t.xMm,
          yMm: t.yMm,

          vxMmS: t.vxMmS,
          vyMmS: t.vyMmS,
          speedMmS: t.speedMmS,

          ageMs: t.ageMs,
          lastSeenMs: t.lastSeenMs,

          sourceRadars: t.sourceRadars,
        }

        if (debugEnabled && t.debug) {
          item.debug = t.debug
        }

        return item
      })

    const payload = {
      targets: out,
    }

    if (meta) {
      payload.meta = debugEnabled ? meta : this.#stripTargetsMeta(meta)

      const now = this.#clock.nowMs()
      if ((now - this.#lastHealthPublishTs) >= 1000) {
        this.#lastHealthPublishTs = now
        payload.health = this.#makeHealthFromMeta(meta, now)
      }
    }

    this.#mainBus.publish({
      type: eventTypes.presence.targets,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.presence.targets,
        where: busIds.main,
      }),
      payload,
    })
  }

  #makeHealthFromMeta(meta, now) {
    const m = meta || {}

    return {
      ts: now,

      radarsExpected: m.radarsExpected ?? null,
      radarsSeenTotal: m.radarsSeenTotal ?? null,

      radarsFresh: m.radarsFresh ?? null,
      radarsStale: m.radarsStale ?? null,
      radarsMissing: m.radarsMissing ?? null,

      maxRadarAgeMs: m.maxRadarAgeMs ?? null,
      maxRecvLagMs: m.maxRecvLagMs ?? null,

      tickLagMsP95: m.tickLagMsP95 ?? null,
      tickLagMsMax: m.tickLagMsMax ?? null,
      tickLagSamples: m.tickLagSamples ?? null,

      activeTracks: m.activeTracks ?? null,

      snapshotsAdvancedThisTick: m.snapshotsAdvancedThisTick ?? null,
      radarsAdvancedCount: m.radarsAdvancedCount ?? null,

      stuckTicks: m.stuckTicks ?? null,
      stuck: m.stuck ?? null,

      tickIntervalMs: m.tickIntervalMs ?? null,
    }
  }

  #stripTargetsMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta

    const out = { ...meta }

    if (out.debug) delete out.debug
    if (out.fusion) delete out.fusion

    return out
  }
}

export default PresenceController
