// src/app/charlieRpcClient.js
import WebSocket from 'ws'

/**
 * Charlie RPC WebSocket client.
 *
 * Connects to the daemon's RPC endpoint and provides a simple request/response API.
 *
 * Endpoint:
 * - ws://<host>:<port>/rpc
 *
 * Protocol:
 * - Request:  { id, type, payload }
 * - Success:  { id, ok: true,  type, payload }
 * - Error:    { id, ok: false, type, error: { message, code } }
 *
 * Notes:
 * - This client is RPC-only. It does not handle bus streaming events.
 * - For bus streaming, use `CharlieStreamClient` on `/ws?...`.
 *
 * @example
 * const rpc = new CharlieRpcClient({ logger, url: 'ws://127.0.0.1:8787/rpc' })
 * await rpc.connect()
 * const snap = await rpc.request('state.get')
 * console.log(snap)
 */
export class CharlieRpcClient {
  #logger
  #url
  #ws
  #pending

  constructor({ logger, url }) {
    this.#logger = logger
    this.#url = url
    this.#ws = null
    this.#pending = new Map()
  }

  /**
   * Establish the WebSocket connection (idempotent).
   *
   * @returns {Promise<void>}
   *
   * @example
   * await rpc.connect()
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

  /**
   * Send an RPC request and await its response.
   *
   * @param {string} type RPC method name (e.g. "state.get", "inject.enable")
   * @param {object} [payload={}] RPC payload object
   *
   * @returns {Promise<object>} The `payload` of the RPC response on success.
   * @throws {Error} On transport errors, disconnect, or RPC error response.
   *
   * @example
   * const res = await rpc.request('inject.event', { bus: 'main', type: 'presence:enter', payload: { zone: 'front' } })
   * console.log(res)
   */
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

  /* concise private bits */

  #onMessage(raw) {
    let msg = null

    try {
      msg = JSON.parse(raw.toString())
    } catch (e) {
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

export default CharlieRpcClient
