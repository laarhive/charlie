// src/core/busTap.js
export class BusTap {
  #bus
  #logger
  #enabled
  #unsubscribe

  constructor({ bus, logger, enabled = false }) {
    this.#bus = bus
    this.#logger = logger
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
   * if (tap.isEnabled()) logger.info('tap_enabled', {})
   */
  isEnabled() {
    return this.#enabled
  }

  /**
   * Enables or disables the bus tap.
   *
   * @param {boolean} enabled
   *
   * @example
   * tap.setEnabled(true)
   */
  setEnabled(enabled) {
    const next = Boolean(enabled)
    if (next === this.#enabled) {
      return
    }

    this.#enabled = next

    if (this.#enabled) {
      this.#subscribe()
      this.#logger.notice('tap_enabled', {})
      return
    }

    this.#unsubscribeNow()
    this.#logger.notice('tap_disabled', {})
  }

  /**
   * Dispose unsubscribes if enabled.
   *
   * @example
   * tap.dispose()
   */
  dispose() {
    this.#unsubscribeNow()
  }

  #subscribe() {
    if (this.#unsubscribe) {
      return
    }

    this.#unsubscribe = this.#bus.subscribe((event) => {
      this.#logger.debug('bus_event', event)
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
