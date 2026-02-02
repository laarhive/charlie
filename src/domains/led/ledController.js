// src/domain/led/ledController.js
import eventTypes from '../../core/eventTypes.js'
import domainEventTypes from '../domainEventTypes.js'

export default class LedController {
  #logger
  #ledBus
  #mainBus
  #clock
  #controllerId

  #ledsById
  #unsubscribe

  constructor({ logger, ledBus, mainBus, clock, controllerId, devices }) {
    this.#logger = logger
    this.#ledBus = ledBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'ledController'

    this.#ledsById = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const x of list) {
      if (!x?.id) continue
      this.#ledsById.set(x.id, x)
    }
  }

  start() {
    if (this.#unsubscribe) return

    this.#logger.notice('led_controller_started', { controllerId: this.#controllerId })

    this.#unsubscribe = this.#mainBus.subscribe((event) => {
      if (!event?.type) return

      if (event.type === eventTypes.presence.enter) {
        this.#onPresenceEnter(event)
        return
      }

      if (event.type === eventTypes.presence.exit) {
        this.#onPresenceExit(event)
        return
      }

      if (event.type === eventTypes.vibration.hit) {
        this.#onVibrationHit(event)
        return
      }

      if (event.type === eventTypes.button.press) {
        this.#onButtonPress(event)
      }
    })
  }

  dispose() {
    if (!this.#unsubscribe) return

    this.#unsubscribe()
    this.#unsubscribe = null

    this.#logger.notice('led_controller_disposed', { controllerId: this.#controllerId })
  }

  #onPresenceEnter(event) {
    const ledId = this.#pickDefaultLedId()
    this.#publishRgb({ ledId, publishAs: null, rgb: [0, 255, 0] })
  }

  #onPresenceExit(event) {
    const ledId = this.#pickDefaultLedId()
    this.#publishRgb({ ledId, publishAs: null, rgb: [0, 0, 0] })
  }

  #onVibrationHit(event) {
    const ledId = this.#pickDefaultLedId()

    this.#publishRgb({ ledId, publishAs: null, rgb: [255, 0, 0] })

    setTimeout(() => {
      this.#publishRgb({ ledId, publishAs: null, rgb: [0, 0, 0] })
    }, 120)
  }

  #onButtonPress(event) {
    const ledId = this.#pickDefaultLedId()
    this.#publishRgb({ ledId, publishAs: null, rgb: [0, 60, 255] })
  }

  #publishRgb({ ledId, publishAs, rgb }) {
    const safe = this.#clampRgb(rgb)

    const e = {
      type: domainEventTypes.led.command,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: {
        ledId: ledId || null,
        publishAs: publishAs || null,
        rgb: safe,
      },
    }

    this.#logger.debug('event_publish', e)
    this.#ledBus.publish(e)
  }

  #pickDefaultLedId() {
    for (const [id, led] of this.#ledsById.entries()) {
      if (led?.enabled === false) continue
      return id
    }

    return null
  }

  #clampRgb(rgb) {
    const a = Array.isArray(rgb) ? rgb : []
    const r = this.#clampByte(a[0])
    const g = this.#clampByte(a[1])
    const b = this.#clampByte(a[2])
    return [r, g, b]
  }

  #clampByte(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(255, Math.round(n)))
  }
}
