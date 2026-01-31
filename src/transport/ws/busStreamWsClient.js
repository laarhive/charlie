// src/transport/ws/busStreamWsClient.js
import WebSocket from 'ws'

/**
 * Charlie bus streaming WebSocket client.
 *
 * Connects to the daemon's streaming endpoint and emits server-pushed bus events.
 *
 * Endpoint:
 * - ws://<host>:<port>/ws
 *
 * Bus selection is done via query params at connect time:
 * - /ws               -> default: main
 * - /ws?main&button   -> main + button
 * - /ws?all           -> all buses
 *
 * Streaming messages:
 * ```json
 * {
 *   "type": "bus.event",
 *   "payload": { "bus": "main", "event": { "type": "...", "ts": 0, "source": "...", "payload": {} } }
 * }
 * ```
 *
 * Notes:
 * - This client is streaming-only. It does not support RPC requests.
 *
 * @example
 * const stream = new CharlieStreamClient({ logger, url: 'ws://127.0.0.1:8787/ws?all' })
 * stream.onBusEvent(({ bus, event }) => console.log(bus, event.type))
 * await stream.connect()
 */
export class BusStreamWsClient {
  #logger
  #url
  #ws
  #busHandlers

  constructor({ logger, url }) {
    this.#logger = logger
    this.#url = url
    this.#ws = null
    this.#busHandlers = new Set()
  }

  /**
   * Establish the WebSocket connection (idempotent).
   *
   * @returns {Promise<void>}
   *
   * @example
   * await stream.connect()
   */
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

  /**
   * Register a handler for server-pushed bus events.
   *
   * Handler receives the `bus.event` payload:
   *   { bus: string, event: object }
   *
   * @param {function} fn
   * @returns {function} unsubscribe function
   *
   * @example
   * const off = stream.onBusEvent(({ bus, event }) => console.log(bus, event.type))
   * off()
   */
  onBusEvent(fn) {
    this.#busHandlers.add(fn)

    return () => {
      this.#busHandlers.delete(fn)
    }
  }

  /* concise private bits */

  #onMessage(raw) {
    let msg = null

    try {
      msg = JSON.parse(raw.toString())
    } catch (e) {
      return
    }

    if (msg?.type !== 'bus.event') {
      return
    }

    const payload = msg?.payload
    if (!payload) {
      return
    }

    for (const fn of this.#busHandlers) {
      try {
        fn(payload)
      } catch (e) {
        // ignore handler errors
      }
    }
  }
}

export default BusStreamWsClient
