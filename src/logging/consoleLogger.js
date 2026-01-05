import Logger from './logger.js'

const ConsoleLogger = class ConsoleLogger extends Logger {
  #level

  constructor({ level = 'info' } = {}) {
    super()
    this.#level = level
  }

  info(eventName, data = {}) {
    if (!this.#allows('info')) {
      return
    }

    console.log(this.#fmt('info', eventName, data))
  }

  warn(eventName, data = {}) {
    if (!this.#allows('warn')) {
      return
    }

    console.log(this.#fmt('warn', eventName, data))
  }

  error(eventName, data = {}) {
    if (!this.#allows('error')) {
      return
    }

    console.log(this.#fmt('error', eventName, data))
  }

  debug(eventName, data = {}) {
    if (!this.#allows('debug')) {
      return
    }

    console.log(this.#fmt('debug', eventName, data))
  }

  /* concise */
  #allows(level) {
    const order = ['debug', 'info', 'warn', 'error']
    return order.indexOf(level) >= order.indexOf(this.#level)
  }

  /* concise */
  #fmt(level, eventName, data) {
    const ts = new Date().toISOString()
    const payload = Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''
    return `[${ts}] [${level}] ${eventName}${payload}`
  }
}

export default ConsoleLogger
