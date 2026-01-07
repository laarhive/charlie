// src/domain/button/edgeButtonController.js
import PushButtonController from './pushButtonController.js'
import rawEventTypes from '../../core/rawEventTypes.js'

export class EdgeButtonController extends PushButtonController {
  #sensorsById
  #unsubscribe
  #lastPressTsBySensor

  constructor({ logger, buttonBus, mainBus, clock, controllerId, sensors }) {
    super({ logger, buttonBus, mainBus, clock, controllerId })

    this.#sensorsById = new Map()
    this.#unsubscribe = null
    this.#lastPressTsBySensor = new Map()

    const list = Array.isArray(sensors) ? sensors : []
    for (const s of list) {
      if (!s?.id) {
        continue
      }

      this.#sensorsById.set(s.id, s)
      this.#lastPressTsBySensor.set(s.id, null)
    }
  }

  start() {
    if (this.#unsubscribe) {
      return
    }

    this._logger().notice('button_controller_started', { controllerId: this._controllerId(), mode: 'edge' })

    this.#unsubscribe = this._buttonBus().subscribe((event) => {
      if (event?.type !== rawEventTypes.button.edge) {
        return
      }

      this.#onEdge(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) {
      return
    }

    this.#unsubscribe()
    this.#unsubscribe = null

    this._logger().notice('button_controller_disposed', { controllerId: this._controllerId() })
  }

  #onEdge(event) {
    const p = event?.payload || {}
    const sensorId = p.sensorId
    const edge = p.edge

    if (edge !== 'press') {
      return
    }

    const sensor = this.#sensorsById.get(sensorId)
    if (!sensor) {
      this._logger().warning('button_unknown_sensor', { sensorId })
      return
    }

    if (!sensor.enabled) {
      return
    }

    const now = this._clock().nowMs()
    const cooldownMs = sensor.params?.cooldownMs ?? 250
    const last = this.#lastPressTsBySensor.get(sensorId)

    if (last !== null && cooldownMs > 0) {
      const dt = now - last
      if (dt < cooldownMs) {
        return
      }
    }

    this.#lastPressTsBySensor.set(sensorId, now)
    this._publishPress({ sensorId })
  }
}

export default EdgeButtonController
