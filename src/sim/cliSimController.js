const CliSimController = class SimulationController {
  #clock
  #bus
  #core
  #logger

  constructor({ clock, bus, core, logger }) {
    this.#clock = clock
    this.#bus = bus
    this.#core = core
    this.#logger = logger
  }

  /**
   * Simulates presence enter for a zone.
   *
   * @param {'front'|'back'} zone
   *
   * @example
   * sim.presenceOn('front')
   */
  presenceOn(zone) {
    this.#publishPresence('presence:enter', zone)
  }

  /**
   * Simulates presence exit for a zone.
   *
   * @param {'front'|'back'} zone
   *
   * @example
   * sim.presenceOff('front')
   */
  presenceOff(zone) {
    this.#publishPresence('presence:exit', zone)
  }

  /**
   * Sets the logical local time.
   *
   * @param {object} params
   * @param {number} params.year
   * @param {number} params.month
   * @param {number} params.day
   * @param {number} params.hour
   * @param {number} params.minute
   *
   * @example
   * sim.setLocalTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })
   */
  setLocalTime({ year, month, day, hour, minute }) {
    this.#clock.setLocalDateTime({ year, month, day, hour, minute })
    this.#logger.info('time_set', { year, month, day, hour, minute, nowMs: this.#clock.nowMs() })
  }

  /**
   * Advances logical time by ms.
   *
   * @param {number} ms
   *
   * @example
   * sim.advanceMs(1000)
   */
  advanceMs(ms) {
    this.#clock.advance(ms)
    this.#logger.info('time_advanced', { deltaMs: ms, nowMs: this.#clock.nowMs() })
  }

  /**
   * Returns the core snapshot.
   *
   * @example
   * const snapshot = sim.getSnapshot()
   */
  getSnapshot() {
    return this.#core.getSnapshot()
  }

  /**
   * Returns local time parts for the current logical time.
   *
   * @example
   * const t = sim.getLocalTimeParts()
   */
  getLocalTimeParts() {
    return this.#clock.toLocalParts()
  }

  /* concise */
  #publishPresence(type, zone) {
    if (zone !== 'front' && zone !== 'back') {
      this.#logger.warn('invalid_zone', { zone })
      return
    }

    const event = {
      type,
      ts: this.#clock.nowMs(),
      source: 'sim',
      payload: { zone }
    }

    this.#logger.debug('sim_event_publish', event)
    this.#bus.publish(event)
  }
}

export default CliSimController
