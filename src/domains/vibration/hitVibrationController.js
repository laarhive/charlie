// src/domain/vibration/hitVibrationController.js
import VibrationController from './vibrationController.js'
import domainEventTypes from '../domainEventTypes.js'

export class HitVibrationController extends VibrationController {
  #sensorsById
  #unsubscribe
  #lastHitTsBySensor

  constructor({ logger, vibrationBus, mainBus, clock, controllerId, devices }) {
    super({ logger, vibrationBus, mainBus, clock, controllerId })

    this.#sensorsById = new Map()
    this.#unsubscribe = null
    this.#lastHitTsBySensor = new Map()

    const list = Array.isArray(devices) ? devices : []

    for (const s of list) {
      if (!s?.id) {
        continue
      }

      this.#sensorsById.set(s.id, s)
      this.#lastHitTsBySensor.set(s.id, null)
    }
  }

  start() {
    if (this.#unsubscribe) {
      return
    }

    this._logger().notice('vibration_controller_started', { controllerId: this._controllerId(), mode: 'hit' })

    this.#unsubscribe = this._vibrationBus().subscribe((event) => {
      if (event?.type !== domainEventTypes.vibration.hit) {
        return
      }

      this.#onHit(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) {
      return
    }

    this.#unsubscribe()
    this.#unsubscribe = null

    this._logger().notice('vibration_controller_disposed', { controllerId: this._controllerId() })
  }

  #onHit(event) {
    const p = event?.payload || {}
    const sensorId = p.sensorId

    const sensor = this.#sensorsById.get(sensorId)
    if (!sensor) {
      this._logger().warning('vibration_unknown_sensor', { sensorId })
      return
    }

    if (sensor.enabled === false) {
      return
    }

    const now = this._clock().nowMs()
    const cooldownMs = sensor.params?.cooldownMs ?? 0
    const last = this.#lastHitTsBySensor.get(sensorId)

    if (last !== null && cooldownMs > 0) {
      const dt = now - last
      if (dt < cooldownMs) {
        return
      }
    }

    this.#lastHitTsBySensor.set(sensorId, now)

    const level = sensor.level || sensor.params?.level || 'unknown'
    this._publishHit({ level, sensorId })
  }
}

export default HitVibrationController
