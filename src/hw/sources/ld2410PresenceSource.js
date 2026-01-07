// src/hw/sources/ld2410PresenceSource.js
import Source from './source.js'
import eventTypes from '../../core/eventTypes.js'

export class Ld2410PresenceSource extends Source {
  #logger
  #bus
  #clock
  #sensor
  #input

  #unsubscribe
  #isStarted

  #raw
  #stable
  #pendingTimer
  #pendingValue

  constructor({ logger, bus, clock, sensor, input }) {
    super()

    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#sensor = sensor
    this.#input = input

    this.#unsubscribe = null
    this.#isStarted = false

    this.#raw = false
    this.#stable = false
    this.#pendingTimer = null
    this.#pendingValue = null
  }

  start() {
    if (this.#isStarted) {
      return
    }

    this.#isStarted = true
    this.#raw = Boolean(this.#input.read())
    this.#stable = this.#raw

    this.#unsubscribe = this.#input.subscribe((value) => {
      this.#onRawChange(Boolean(value))
    })

    this.#logger.notice('source_started', { sensorId: this.#sensor.id, type: this.#sensor.type, role: this.#sensor.role })
  }

  dispose() {
    if (!this.#isStarted) {
      return
    }

    this.#isStarted = false

    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    this.#clearPending()
    this.#logger.notice('source_disposed', { sensorId: this.#sensor.id })
  }

  /* debounce scheduling */
  #onRawChange(value) {
    this.#raw = value

    const onMs = this.#sensor.params?.debounceOnMs ?? 0
    const offMs = this.#sensor.params?.debounceOffMs ?? 0
    const delayMs = value ? onMs : offMs

    this.#scheduleStable(value, delayMs)
  }

  #scheduleStable(value, delayMs) {
    this.#clearPending()

    if (delayMs <= 0) {
      this.#applyStable(value)
      return
    }

    this.#pendingValue = value
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null
      const v = this.#pendingValue
      this.#pendingValue = null

      if (v !== this.#raw) {
        return
      }

      this.#applyStable(v)
    }, delayMs)
  }

  #applyStable(value) {
    if (value === this.#stable) {
      return
    }

    this.#stable = value

    const event = {
      type: value ? eventTypes.presence.enter : eventTypes.presence.exit,
      ts: this.#clock.nowMs(),
      source: 'sensor',
      payload: {
        zone: this.#sensor.zone,
        sensorId: this.#sensor.id,
      },
    }

    this.#logger.debug('event_publish', event)
    this.#bus.publish(event)
  }

  #clearPending() {
    if (!this.#pendingTimer) {
      return
    }

    clearTimeout(this.#pendingTimer)
    this.#pendingTimer = null
    this.#pendingValue = null
  }
}

export default Ld2410PresenceSource
