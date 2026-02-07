// src/domains/vibration/vibrationController.js
import eventTypes from '../../core/eventTypes.js'
import { makeStreamKey } from '../../core/eventBus.js'
import { busIds } from '../../app/buses.js'
import domainEventTypes from '../domainEventTypes.js'

export default class VibrationController {
  #logger
  #vibrationBus
  #mainBus
  #clock
  #controllerId

  #sensorsById
  #lastHitTsBySensor
  #unsubscribe

  constructor({ logger, vibrationBus, mainBus, clock, controllerId, devices }) {
    this.#logger = logger
    this.#vibrationBus = vibrationBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'vibrationController'

    this.#sensorsById = new Map()
    this.#lastHitTsBySensor = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const s of list) {
      if (!s?.id) continue

      this.#sensorsById.set(s.id, s)
      this.#lastHitTsBySensor.set(s.id, null)
    }
  }

  get streamKeyWho() { return this.#controllerId }

  start() {
    if (this.#unsubscribe) return

    this.#logger.notice('vibration_controller_started', { controllerId: this.#controllerId, mode: 'hit' })

    this.#unsubscribe = this.#vibrationBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.vibration.hit) return

      this.#onHit(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) return

    this.#unsubscribe()
    this.#unsubscribe = null

    this.#logger.notice('vibration_controller_disposed', { controllerId: this.#controllerId })
  }

  #onHit(event) {
    const p = event?.payload || {}
    const sensorId = p.sensorId

    const sensor = this.#sensorsById.get(sensorId)
    if (!sensor) {
      this.#logger.warning('vibration_unknown_sensor', { sensorId })
      return
    }

    if (sensor.enabled === false) return

    const now = this.#clock.nowMs()
    const cooldownMs = sensor.params?.cooldownMs ?? 0
    const last = this.#lastHitTsBySensor.get(sensorId)

    if (last !== null && cooldownMs > 0) {
      const dt = now - last
      if (dt < cooldownMs) return
    }

    this.#lastHitTsBySensor.set(sensorId, now)

    const level = sensor.level || sensor.params?.level || 'unknown'
    this.#publishHit({ level, sensorId })
  }

  #publishHit({ level, sensorId }) {
    const event = {
      type: eventTypes.vibration.hit,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.vibration.hit,
        where: busIds.main,
      }),
      payload: { level, sensorId },
    }

    this.#logger.debug('event_publish', event)
    this.#mainBus.publish(event)
  }
}
