// src/domains/presence/presenceController.js
import eventTypes from '../../core/eventTypes.js'
import domainEventTypes from '../domainEventTypes.js'
import Ld2450IngestAdapter from './ld2450IngestAdapter.js'
import Ld2410IngestAdapter from './ld2410IngestAdapter.js'
import { TrackingPipeline } from './tracking/trackingPipeline.js'

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

    this.#logger.notice('presence_controller_disposed', { controllerId: this.#controllerId })
  }

  #publishTargetsFromGlobalTracks(event) {
    const p = event?.payload || {}
    const tracks = Array.isArray(p.tracks) ? p.tracks : []

    this.#mainBus.publish({
      type: eventTypes.presence.targets,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: {
        targets: tracks
          .filter((t) => t && t.state === 'confirmed')
          .map((t) => ({
            id: t.id,

            xMm: t.xMm,
            yMm: t.yMm,

            vxMmS: t.vxMmS,
            vyMmS: t.vyMmS,
            speedMmS: t.speedMmS,

            ageMs: t.ageMs,
            lastSeenMs: t.lastSeenMs,

            sourceRadars: t.sourceRadars,
          })),
      },
    })
  }
}

export default PresenceController
