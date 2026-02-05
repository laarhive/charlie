// public/debug/presence/wsClient.js
export class WsClient {
  #url
  #ws
  #onMessage
  #onStatus

  constructor({ url, onMessage, onStatus }) {
    this.#url = url
    this.#ws = null
    this.#onMessage = onMessage
    this.#onStatus = onStatus
  }

  connect() {
    this.close()

    this.#onStatus?.({ state: 'connecting' })

    const ws = new WebSocket(this.#url)
    this.#ws = ws

    ws.onopen = () => {
      this.#onStatus?.({ state: 'open' })
    }

    ws.onclose = () => {
      this.#onStatus?.({ state: 'closed' })
    }

    ws.onerror = () => {
      this.#onStatus?.({ state: 'error' })
    }

    ws.onmessage = (ev) => {
      let msg = null
      try {
        msg = JSON.parse(ev.data)
      } catch (e) {
        return
      }

      this.#onMessage?.(msg)
    }
  }

  close() {
    if (!this.#ws) return

    try {
      this.#ws.close()
    } catch (e) {
      // ignore
    }

    this.#ws = null
  }
}
