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

  constructor({ logger, ledBus, mainBus, clock, controllerId, leds }) {
    this.#logger = logger
    this.#ledBus = ledBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'ledController'

    this.#ledsById = new Map()
    this.#unsubscribe = null

    const list = Array.isArray(leds) ? leds : []
    for (const x of list) {
      if (!x?.id) continue
      this.#ledsById.set(x.id, x)
    }
  }

  /**
   * Starts the controller (subscribe to mainBus).
   *
   * @example
   * controller.start()
   */
  start() {
    if (this.#unsubscribe) return

    this.#logger.notice('led_controller_started', { controllerId: this.#controllerId, mode: 'rgb' })

    this.#unsubscribe = this.#mainBus.subscribe((event) => {
      if (!event?.type) return

      if (event.type === eventTypes.led.setRgb) {
        this.#onSetRgb(event)
        return
      }

      if (event.type === eventTypes.led.off) {
        this.#onOff(event)
      }
    })
  }

  /**
   * Disposes the controller (unsubscribe).
   *
   * @example
   * controller.dispose()
   */
  dispose() {
    if (!this.#unsubscribe) return

    this.#unsubscribe()
    this.#unsubscribe = null

    this.#logger.notice('led_controller_disposed', { controllerId: this.#controllerId })
  }

  #onSetRgb(event) {
    const p = event?.payload || {}

    const ledId = this.#asOptId(p.ledId)
    const publishAs = this.#asOptId(p.publishAs)

    const r = this.#clampByte(p.r)
    const g = this.#clampByte(p.g)
    const b = this.#clampByte(p.b)

    const led = ledId ? this.#ledsById.get(ledId) : null
    if (ledId && !led) {
      this.#logger.warning('led_unknown_target', { ledId })
      return
    }

    if (led && led.enabled === false) return

    this.#publishCommand({
      ledId,
      publishAs,
      command: 'setRgb',
      args: { r, g, b },
    })
  }

  #onOff(event) {
    const p = event?.payload || {}

    const ledId = this.#asOptId(p.ledId)
    const publishAs = this.#asOptId(p.publishAs)

    const led = ledId ? this.#ledsById.get(ledId) : null
    if (ledId && !led) {
      this.#logger.warning('led_unknown_target', { ledId })
      return
    }

    if (led && led.enabled === false) return

    this.#publishCommand({
      ledId,
      publishAs,
      command: 'off',
      args: {},
    })
  }

  #publishCommand({ ledId, publishAs, command, args }) {
    const event = {
      type: domainEventTypes.led.command,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      payload: {
        ledId: ledId || null,
        publishAs: publishAs || null,
        command: String(command || '').trim(),
        args: args || {},
      },
    }

    this.#logger.debug('event_publish', event)
    this.#ledBus.publish(event)
  }

  #clampByte(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(255, Math.round(n)))
  }

  #asOptId(x) {
    const s = String(x || '').trim()
    return s.length > 0 ? s : null
  }
}
