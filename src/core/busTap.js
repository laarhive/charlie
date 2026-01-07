// src/core/busTap.js
export class BusTap {
  #bus
  #logger
  #name
  #enabled
  #unsubscribe

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

    if (enabled) {
      this.setEnabled(true)
    }
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
  }

  /* concise private bits */

  #subscribe() {
    if (this.#unsubscribe) {
      return
    }

    this.#unsubscribe = this.#bus.subscribe((event) => {
      this.#logger.debug('bus_event', { bus: this.#name, event })
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
