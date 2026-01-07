// src/domain/presence/binaryPresenceController.js
import PresenceController from './presenceController.js'
import rawEventTypes from '../../core/rawEventTypes.js'

export class BinaryPresenceController extends PresenceController {
  #sensorsById
  #unsubscribe

  #rawBySensor
  #stableBySensor
  #pendingTimers

  constructor({ logger, presenceBus, mainBus, clock, controllerId, sensors }) {
    super({ logger, presenceBus, mainBus, clock, controllerId })

    this.#sensorsById = new Map()
    this.#unsubscribe = null

    this.#rawBySensor = new Map()
    this.#stableBySensor = new Map()
    this.#pendingTimers = new Map()

    const list = Array.isArray(sensors) ? sensors : []
    for (const s of list) {
      if (!s?.id) {
        continue
      }

      this.#sensorsById.set(s.id, s)
      this.#rawBySensor.set(s.id, false)
      this.#stableBySensor.set(s.id, false)
    }
  }

  start() {
    if (this.#unsubscribe) {
      return
    }

    this._logger().notice('presence_controller_started', { controllerId: this._controllerId(), mode: 'binary' })

    this.#unsubscribe = this._presenceBus().subscribe((event) => {
      if (event?.type !== rawEventTypes.presence.binary) {
        return
      }

      this.#onBinary(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) {
      return
    }

    this.#unsubscribe()
    this.#unsubscribe = null

    for (const timer of this.#pendingTimers.values()) {
      clearTimeout(timer)
    }

    this.#pendingTimers.clear()
    this._logger().notice('presence_controller_disposed', { controllerId: this._controllerId() })
  }

  #onBinary(event) {
    const p = event?.payload || {}
    const sensorId = p.sensorId
    const zone = p.zone
    const present = Boolean(p.present)

    const sensor = this.#sensorsById.get(sensorId)
    if (!sensor) {
      this._logger().warning('presence_unknown_sensor', { sensorId })
      return
    }

    if (!sensor.enabled) {
      return
    }

    if (zone !== 'front' && zone !== 'back') {
      this._logger().warning('presence_invalid_zone', { sensorId, zone })
      return
    }

    this.#rawBySensor.set(sensorId, present)

    const onMs = sensor.params?.debounceOnMs ?? 0
    const offMs = sensor.params?.debounceOffMs ?? 0
    const delayMs = present ? onMs : offMs

    this.#scheduleStable(sensorId, { zone, present, delayMs })
  }

  #scheduleStable(sensorId, { zone, present, delayMs }) {
    this.#clearPending(sensorId)

    if (delayMs <= 0) {
      this.#applyStable(sensorId, { zone, present })
      return
    }

    const timer = setTimeout(() => {
      this.#pendingTimers.delete(sensorId)

      const rawNow = this.#rawBySensor.get(sensorId)
      if (rawNow !== present) {
        return
      }

      this.#applyStable(sensorId, { zone, present })
    }, delayMs)

    this.#pendingTimers.set(sensorId, timer)
  }

  #applyStable(sensorId, { zone, present }) {
    const stable = this.#stableBySensor.get(sensorId)
    if (stable === present) {
      return
    }

    this.#stableBySensor.set(sensorId, present)

    if (present) {
      this._publishEnter({ zone, sensorId })
      return
    }

    this._publishExit({ zone, sensorId })
  }

  #clearPending(sensorId) {
    const timer = this.#pendingTimers.get(sensorId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.#pendingTimers.delete(sensorId)
  }
}

export default BinaryPresenceController
