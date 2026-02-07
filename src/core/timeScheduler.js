import crypto from 'node:crypto'
import { makeStreamKey } from './eventBus.js'

export class TimeScheduler {
  #clock
  #bus
  #timers
  #unsubscribeClock

  /**
   * @param {object} deps
   * @param {object} deps.clock - must support nowMs() and onChange(handler)
   * @param {object} deps.bus - must support publish(event)
   */
  constructor({ clock, bus }) {
    this.#clock = clock
    this.#bus = bus
    this.#timers = new Map()

    this.#unsubscribeClock = this.#clock.onChange(() => {
      this.#rescheduleAll()
    })
  }

  get streamKeyWho() { return 'timeScheduler' }

  /**
   * Schedule an event at an absolute logical time.
   *
   * @param {object} params
   * @param {number} params.atMs
   * @param {string} params.type
   * @param {object} params.payload
   * @returns {string} token
   *
   * @example
   * const token = scheduler.scheduleAt({ atMs: clock.nowMs() + 1000, type: 'time:armingExpired', payload: { stateVersion: 1 } })
   */
  scheduleAt({ atMs, type, payload = {} }) {
    const token = this.#makeToken()
    const timer = {
      token,
      atMs,
      type,
      payload,
      handle: null
    }

    this.#timers.set(token, timer)
    this.#armTimer(timer)

    return token
  }

  /**
   * Schedule an event after a delay in ms.
   *
   * @param {object} params
   * @param {number} params.delayMs
   * @param {string} params.type
   * @param {object} params.payload
   * @returns {string} token
   *
   * @example
   * scheduler.scheduleIn({ delayMs: 1200, type: 'time:armingExpired', payload: { stateVersion: 2 } })
   */
  scheduleIn({ delayMs, type, payload = {} }) {
    const atMs = this.#clock.nowMs() + delayMs
    return this.scheduleAt({ atMs, type, payload })
  }

  /**
   * Cancels a scheduled event.
   *
   * @param {string|null} token
   *
   * @example
   * scheduler.cancel(token)
   */
  cancel(token) {
    if (!token) {
      return
    }

    const timer = this.#timers.get(token)
    if (!timer) {
      return
    }

    if (timer.handle) {
      clearTimeout(timer.handle)
    }

    this.#timers.delete(token)
  }

  /**
   * Stops the scheduler and clears timers.
   *
   * @example
   * scheduler.dispose()
   */
  dispose() {
    if (this.#unsubscribeClock) {
      this.#unsubscribeClock()
      this.#unsubscribeClock = null
    }

    for (const timer of this.#timers.values()) {
      if (timer.handle) {
        clearTimeout(timer.handle)
      }
    }

    this.#timers.clear()
  }

  #rescheduleAll() {
    const frozen = this.#clock.isFrozen()

    for (const timer of this.#timers.values()) {
      if (timer.handle) {
        clearTimeout(timer.handle)
        timer.handle = null
      }

      this.#armTimer(timer, frozen)
    }
  }

  #armTimer(timer, frozen) {
    const now = this.#clock.nowMs()
    const delayMs = Math.max(0, timer.atMs - now)

    if (delayMs === 0) {
      timer.handle = setTimeout(() => {
        this.#fire(timer.token)
      }, 0)

      return
    }

    if (frozen) {
      /* clock is frozen: do not arm real-time timeouts */
      return
    }

    timer.handle = setTimeout(() => {
      this.#fire(timer.token)
    }, delayMs)
  }

  #fire(token) {
    const timer = this.#timers.get(token)
    if (!timer) {
      return
    }

    this.#timers.delete(token)

    this.#bus.publish({
      type: timer.type,
      ts: this.#clock.nowMs(),
      source: 'time',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: timer.type,
        where: this.#bus.getBusId(),
      }),
      payload: {
        ...timer.payload,
        token: timer.token,
        atMs: timer.atMs
      }
    })
  }

  #makeToken() {
    return crypto.randomBytes(8).toString('hex')
  }
}

export default TimeScheduler
