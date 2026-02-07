// src/domain/button/buttonController.js
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

import eventTypes from '../../core/eventTypes.js'
import domainEventTypes from '../domainEventTypes.js'
import { makeStreamKey } from '../../core/eventBus.js'
import { busIds } from '../../app/buses.js'

export default class ButtonController {
  #logger
  #buttonBus
  #mainBus
  #clock
  #controllerId

  #devicesById
  #lastPressTsByDeviceId
  #unsubscribe

  constructor({ logger, buttonBus, mainBus, clock, controllerId, devices }) {
    this.#logger = logger
    this.#buttonBus = buttonBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'buttonController'

    this.#devicesById = new Map()
    this.#lastPressTsByDeviceId = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const d of list) {
      if (!d?.id) continue

      this.#devicesById.set(d.id, d)
      this.#lastPressTsByDeviceId.set(d.id, null)
    }
  }

  get streamKeyWho() { return this.#controllerId }

  start() {
    if (this.#unsubscribe) return

    this.#logger.notice('button_controller_started', { controllerId: this.#controllerId, mode: 'edge' })

    this.#unsubscribe = this.#buttonBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.button.edge) return

      this.#onEdge(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) return

    this.#unsubscribe()
    this.#unsubscribe = null

    this.#logger.notice('button_controller_disposed', { controllerId: this.#controllerId })
  }

  #onEdge(event) {
    const p = event?.payload || {}

    if (p.edge !== 'press') return

    const deviceId = p.deviceId
    const publishAs = p.publishAs

    if (!deviceId) {
      this.#logger.warning('button_missing_deviceId', { payload: p })
      return
    }

    const device = this.#devicesById.get(deviceId)
    if (!device) {
      this.#logger.warning('button_unknown_device', { deviceId })
      return
    }

    const now = this.#clock.nowMs()
    const cooldownMs = device.params?.cooldownMs ?? 250
    const last = this.#lastPressTsByDeviceId.get(deviceId)

    if (last !== null && cooldownMs > 0) {
      const dt = now - last
      if (dt < cooldownMs) return
    }

    this.#lastPressTsByDeviceId.set(deviceId, now)

    const coreRole = device.coreRole ?? device.CoreRole ?? null
    this.#publishPress({ coreRole, deviceId, publishAs })
  }

  #publishPress({ coreRole, deviceId, publishAs }) {
    const payload = {
      coreRole: coreRole ?? null,
      deviceId: deviceId ?? null,
      publishAs: publishAs ?? null,

      /* Backward compatibility for any existing core logic */
      sensorId: publishAs ?? deviceId ?? null,
    }

    const event = {
      type: eventTypes.button.press,
      ts: this.#clock.nowMs(),
      source: 'buttonController',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.button.press,
        where: busIds.main,
      }),
      payload,
    }

    this.#logger.debug('event_publish', { bus: 'main', event })
    this.#mainBus.publish(event)
  }
}
