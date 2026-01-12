import WebSocket from 'ws'

export class CharlieWsClient {
  #logger
  #url
  #ws
  #pending
  #busHandlers

  constructor({ logger, url }) {
    this.#logger = logger
    this.#url = url
    this.#ws = null
    this.#pending = new Map()
    this.#busHandlers = new Set()
  }

  async connect() {
    if (this.#ws) {
      return
    }

    this.#ws = new WebSocket(this.#url)

    this.#ws.on('open', () => {
      this.#logger.notice('ws_connected', { url: this.#url })
    })

    this.#ws.on('close', () => {
      this.#logger.notice('ws_disconnected', { url: this.#url })

      for (const [id, p] of this.#pending.entries()) {
        p.reject(new Error('ws_disconnected'))
      }

      this.#pending.clear()
      this.#ws = null
    })

    this.#ws.on('error', (e) => {
      this.#logger.error('ws_error', { url: this.#url, error: String(e?.message || e) })
    })

    this.#ws.on('message', (raw) => {
      this.#onMessage(raw)
    })

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }

      const onErr = (e) => {
        cleanup()
        reject(e)
      }

      const cleanup = () => {
        this.#ws.off('open', onOpen)
        this.#ws.off('error', onErr)
      }

      this.#ws.on('open', onOpen)
      this.#ws.on('error', onErr)
    })
  }

  onBusEvent(fn) {
    this.#busHandlers.add(fn)

    return () => {
      this.#busHandlers.delete(fn)
    }
  }

  async request(type, payload = {}) {
    if (!this.#ws) {
      throw new Error('ws_not_connected')
    }

    const id = `${Date.now()}:${Math.random().toString(16).slice(2)}`
    const msg = { id, type, payload }

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })

      try {
        this.#ws.send(JSON.stringify(msg))
      } catch (e) {
        this.#pending.delete(id)
        reject(e)
      }
    })
  }

  #onMessage(raw) {
    let msg = null

    try {
      msg = JSON.parse(raw.toString())
    } catch (e) {
      return
    }

    if (msg?.type === 'bus.event') {
      for (const fn of this.#busHandlers) {
        try {
          fn(msg.payload)
        } catch (e) {
          // ignore handler errors
        }
      }

      return
    }

    const id = msg?.id
    if (!id) {
      return
    }

    const p = this.#pending.get(id)
    if (!p) {
      return
    }

    this.#pending.delete(id)

    if (msg.ok) {
      p.resolve(msg.payload)
      return
    }

    const err = new Error(msg?.error?.message || 'ws_request_failed')
    err.code = msg?.error?.code || 'WS_ERROR'
    p.reject(err)
  }
}

export default CharlieWsClient
