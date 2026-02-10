// public/dev/presence/wsClient.js
export class WsClient {
  #url
  #ws
  #onMessage
  #onStatus

  #reconnectTimer
  #shouldReconnect

  #reconnectDelayMs
  #reconnectDelayMaxMs

  constructor({ url, onMessage, onStatus }) {
    this.#url = url
    this.#ws = null
    this.#onMessage = onMessage
    this.#onStatus = onStatus

    this.#reconnectTimer = null
    this.#shouldReconnect = true

    this.#reconnectDelayMs = 500
    this.#reconnectDelayMaxMs = 8000
  }

  connect() {
    this.#clearReconnectTimer()
    this.close()

    this.#shouldReconnect = true
    this.#onStatus?.({ state: 'connecting' })

    const ws = new WebSocket(this.#url)
    this.#ws = ws

    ws.onopen = () => {
      this.#reconnectDelayMs = 500
      this.#onStatus?.({ state: 'open' })
    }

    ws.onclose = () => {
      this.#ws = null
      this.#onStatus?.({ state: 'closed' })

      if (this.#shouldReconnect) {
        this.#scheduleReconnect()
      }
    }

    ws.onerror = () => {
      this.#onStatus?.({ state: 'error' })
      // close will follow → reconnect handled there
    }

    ws.onmessage = (ev) => {
      let msg = null
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }

      this.#onMessage?.(msg)
    }
  }

  close() {
    this.#shouldReconnect = false
    this.#clearReconnectTimer()

    if (!this.#ws) return

    try {
      this.#ws.close()
    } catch {
      // ignore
    }

    this.#ws = null
  }

  #scheduleReconnect() {
    this.#clearReconnectTimer()

    const delay = this.#reconnectDelayMs
    this.#reconnectDelayMs = Math.min(
      this.#reconnectDelayMs * 2,
      this.#reconnectDelayMaxMs
    )

    this.#reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  #clearReconnectTimer() {
    if (!this.#reconnectTimer) return

    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
  }
}

export default WsClient
