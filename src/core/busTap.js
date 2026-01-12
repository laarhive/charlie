// src/core/busTap.js
export class BusTap {
  #bus
  #logger
  #name
  #enabled
  #unsubscribe
  #sink

  /**
   * Bus tap logger for debugging. Can be enabled/disabled at runtime.
   *
   * @param {object} args
   * @param {object} args.bus EventBus instance
   * @param {object} args.logger Logger instance
   * @param {string} args.name Tap name (e.g. "main", "presence")
   * @param {boolean} [args.enabled=false] Initial enabled state
   *
   * @example
   * const tap = new BusTap({ bus, logger, name: 'presence' })
   * tap.setEnabled(true)
   */
  constructor({ bus, logger, name, enabled = false }) {
    this.#bus = bus
    this.#logger = logger
    this.#name = name || 'bus'
    this.#enabled = false
    this.#unsubscribe = null
    this.#sink = null

    if (enabled) {
      this.setEnabled(true)
    }
  }

  /**
   * Attach an optional sink for human-readable output (e.g., console printing).
   * Sink is only invoked when the tap is enabled (because subscription exists only then).
   *
   * @param {function|null} sinkFn
   *
   * @example
   * tap.setSink((line) => console.log(line))
   */
  setSink(sinkFn) {
    this.#sink = typeof sinkFn === 'function' ? sinkFn : null
  }

  /**
   * @returns {boolean}
   *
   * @example
   * if (tap.isEnabled()) logger.info('tap_on', {})
   */
  isEnabled() {
    return this.#enabled
  }

  /**
   * Enable/disable the tap.
   *
   * @param {boolean} enabled
   *
   * @example
   * tap.setEnabled(false)
   */
  setEnabled(enabled) {
    const next = Boolean(enabled)
    if (next === this.#enabled) {
      return
    }

    this.#enabled = next

    if (this.#enabled) {
      this.#subscribe()
      this.#logger.notice('tap_enabled', { bus: this.#name })
      return
    }

    this.#unsubscribeNow()
    this.#logger.notice('tap_disabled', { bus: this.#name })
  }

  /**
   * Cleanup.
   *
   * @example
   * tap.dispose()
   */
  dispose() {
    this.#unsubscribeNow()
    this.#sink = null
  }

  /* concise private bits */

  #subscribe() {
    if (this.#unsubscribe) {
      return
    }

    this.#unsubscribe = this.#bus.subscribe((event) => {
      this.#logger.debug('bus_event', { bus: this.#name, event })

      if (this.#sink && event?.type) {
        const line = `[tap ${this.#name}] ${event.type}`
        this.#sink(line, { bus: this.#name, event })
      }
    })
  }

  #unsubscribeNow() {
    if (!this.#unsubscribe) {
      return
    }

    this.#unsubscribe()
    this.#unsubscribe = null
  }
}

export default BusTap
