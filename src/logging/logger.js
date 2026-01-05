import winston from 'winston'

const makeLocalTimestamp = function makeLocalTimestamp(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value || ''

  const mon = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  const second = get('second')

  return `${mon} ${day} ${hour}:${minute}:${second}`
}

export class Logger {
  #logger

  constructor({ level = 'info' } = {}) {
    const syslogLevels = winston.config.syslog.levels

    const formatLine = winston.format.printf((info) => {
      const ts = makeLocalTimestamp()

      const lvl = info.level
      const name = info.message

      const meta = info.meta && Object.keys(info.meta).length ? info.meta : null
      if (!meta) {
        return `${ts} [${lvl}] ${name}`
      }

      return `${ts} [${lvl}] ${name}\n${JSON.stringify(meta, null, 2)}`
    })

    this.#logger = winston.createLogger({
      levels: syslogLevels,
      level,
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            formatLine
          ),
        }),
      ],
    })
  }

  debug(eventName, data = {}) {
    this.#logger.log('debug', eventName, { meta: data })
  }

  info(eventName, data = {}) {
    this.#logger.log('info', eventName, { meta: data })
  }

  notice(eventName, data = {}) {
    this.#logger.log('notice', eventName, { meta: data })
  }

  warning(eventName, data = {}) {
    this.#logger.log('warning', eventName, { meta: data })
  }

  error(eventName, data = {}) {
    this.#logger.log('error', eventName, { meta: data })
  }

  crit(eventName, data = {}) {
    this.#logger.log('crit', eventName, { meta: data })
  }

  alert(eventName, data = {}) {
    this.#logger.log('alert', eventName, { meta: data })
  }

  emerg(eventName, data = {}) {
    this.#logger.log('emerg', eventName, { meta: data })
  }
}

export default Logger
