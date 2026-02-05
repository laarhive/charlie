// src/transport/ws/busStreamWsClient.js
import WebSocket from 'ws'

/**
 * Charlie bus streaming WebSocket client.
 *
 * Connects to the daemon's WebSocket endpoint in *stream mode* and emits server-pushed bus events.
 *
 * Endpoint:
 * - ws://<host>:<port>/ws
 *
 * Mode selection:
 * - `/ws?…`  => stream mode (supported)
 * - `/ws`    => RPC mode (currently not supported; connection will be closed by the server)
 *
 * Bus selection is done via query params at connect time:
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
 * const stream = new BusStreamWsClient({ logger, url: 'ws://127.0.0.1:8787/ws?all' })
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
    const ws = this.#ws

    ws.on('open', () => {
      this.#logger.notice('ws_connected', { url: this.#url })
    })

    ws.on('close', () => {
      this.#logger.notice('ws_disconnected', { url: this.#url })

      if (this.#ws === ws) {
        this.#ws = null
      }
    })

    ws.on('error', (e) => {
      this.#logger.error('ws_error', { url: this.#url, error: String(e?.message || e) })
    })

    ws.on('message', (raw) => {
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
        ws.off('open', onOpen)
        ws.off('error', onErr)
      }

      ws.on('open', onOpen)
      ws.on('error', onErr)
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
