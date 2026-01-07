// src/domain/presence/targetsPresenceController.js
import PresenceController from './presenceController.js'
import domainEventTypes from '../domainEventTypes.js'

export class TargetsPresenceController extends PresenceController {
  #sensorsById
  #unsubscribe

  constructor({ logger, presenceBus, mainBus, clock, controllerId, sensors }) {
    super({ logger, presenceBus, mainBus, clock, controllerId })

    this.#sensorsById = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(sensors) ? sensors : []
    for (const s of list) {
      if (!s?.id) {
        continue
      }

      this.#sensorsById.set(s.id, s)
    }
  }

  start() {
    if (this.#unsubscribe) {
      return
    }

    this._logger().notice('presence_controller_started', { controllerId: this._controllerId(), mode: 'targets' })

    this.#unsubscribe = this._presenceBus().subscribe((event) => {
      if (event?.type !== domainEventTypes.presence.targets) {
        return
      }

      this.#onTargets(event)
    })
  }

  dispose() {
    if (!this.#unsubscribe) {
      return
    }

    this.#unsubscribe()
    this.#unsubscribe = null

    this._logger().notice('presence_controller_disposed', { controllerId: this._controllerId() })
  }

  #onTargets(event) {
    const p = event?.payload || {}
    const sensorId = p.sensorId
    const targets = Array.isArray(p.targets) ? p.targets : []

    const sensor = this.#sensorsById.get(sensorId)
    if (!sensor) {
      this._logger().warning('presence_unknown_sensor', { sensorId })
      return
    }

    if (!sensor.enabled) {
      return
    }

    this._logger().debug('presence_targets_frame', { sensorId, targetsCount: targets.length })

    // TODO:
    // - map targets (x,y) into zones using configured rectangles/polygons
    // - apply hysteresis / debounce per zone
    // - publish enter/exit via _publishEnter/_publishExit
  }
}

export default TargetsPresenceController
