const Logger = class Logger {
  /**
   * @param {string} eventName
   * @param {object} data
   *
   * @example
   * logger.info('state_transition', { from: 'IDLE', to: 'ARMING' })
   */
  info(eventName, data = {}) {
    throw new Error('not implemented')
  }

  /**
   * @param {string} eventName
   * @param {object} data
   *
   * @example
   * logger.warn('config_load_failed', { filename: 'config.json', error: '...' })
   */
  warn(eventName, data = {}) {
    throw new Error('not implemented')
  }

  /**
   * @param {string} eventName
   * @param {object} data
   *
   * @example
   * logger.error('uncaught', { error: '...' })
   */
  error(eventName, data = {}) {
    throw new Error('not implemented')
  }

  /**
   * @param {string} eventName
   * @param {object} data
   *
   * @example
   * logger.debug('event_received', { type: 'presence:enter' })
   */
  debug(eventName, data = {}) {
    throw new Error('not implemented')
  }
}

export default Logger
