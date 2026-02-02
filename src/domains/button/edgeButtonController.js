// src/domain/button/edgeButtonController.js
/**
 * Domain controller: button edge -> semantic press
 *
 * Input (domain bus: button):
 * - `buttonRaw:edge` with payload: { deviceId, publishAs, edge: 'press' }
 *
 * Output (main bus):
 * - `button:press` with payload: { coreRole, deviceId, publishAs, sensorId }
 *
 * Behavior:
 * - Applies per-device cooldown to suppress rapid repeats.
 * - Does not interpret core semantics; it forwards coreRole from config.
 *
 * @example
 * const c = new EdgeButtonController({ logger, buttonBus, mainBus, clock, controllerId, devices })
 * c.start()
 */

import PushButtonController from './pushButtonController.js'
import domainEventTypes from '../domainEventTypes.js'

export class EdgeButtonController extends PushButtonController {
  #devicesById
  #unsubscribe
  #lastPressTsByDeviceId

  constructor({ logger, buttonBus, mainBus, clock, controllerId, devices }) {
    super({ logger, buttonBus, mainBus, clock, controllerId })

    this.#devicesById = new Map()
    this.#unsubscribe = null
    this.#lastPressTsByDeviceId = new Map()

    const list = Array.isArray(devices) ? devices : []

    for (const d of list) {
      if (!d?.id) {
        continue
      }

      this.#devicesById.set(d.id, d)
      this.#lastPressTsByDeviceId.set(d.id, null)
    }
  }

  start() {
    if (this.#unsubscribe) {
      return
    }

    this._logger().notice('button_controller_started', { controllerId: this._controllerId(), mode: 'edge' })

    this.#unsubscribe = this._buttonBus().subscribe((event) => {
      if (event?.type !== domainEventTypes.button.edge) {
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

    const edge = p.edge
    if (edge !== 'press') {
      return
    }

    const deviceId = p.deviceId
    const publishAs = p.publishAs

    if (!deviceId) {
      this._logger().warning('button_missing_deviceId', { payload: p })
      return
    }

    const device = this.#devicesById.get(deviceId)
    if (!device) {
      this._logger().warning('button_unknown_device', { deviceId })
      return
    }

    const now = this._clock().nowMs()
    const cooldownMs = device.params?.cooldownMs ?? 250
    const last = this.#lastPressTsByDeviceId.get(deviceId)

    if (last !== null && cooldownMs > 0) {
      const dt = now - last
      if (dt < cooldownMs) {
        return
      }
    }

    this.#lastPressTsByDeviceId.set(deviceId, now)

    const coreRole = device.coreRole ?? device.CoreRole ?? null
    this._publishPress({ coreRole, deviceId, publishAs })
  }
}

export default EdgeButtonController
