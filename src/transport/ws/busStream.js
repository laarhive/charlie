// src/core/busStream.js

/**
 * Shared bus subscription fanout for multiple "clients" (WebSocket connections, CLI, etc.).
 *
 * - Subscribes at most once per bus (shared).
 * - Fans out events to attached clients that selected that bus.
 * - Supports selection modes:
 *   - default: main (if available)
 *   - explicit bus list: ['main', 'button']
 *   - all: everything in the registry
 *
 * Event shape forwarded to clients:
 *   { bus: <busName>, event: <eventObject> }
 *
 * @example
 * const stream = new BusStream({ logger, buses })
 *
 * const detach = stream.attachClient({
 *   id: 'ws:1',
 *   select: { buses: ['main', 'button'] },
 *   onEvent: ({ bus, event }) => console.log(bus, event.type),
 * })
 *
 * detach()
 */
export class BusStream {
  #logger
  #buses
  #allowed
  #defaultBus

  /* clientId -> { wanted:Set<string>, onEvent:function } */
  #clients

  /* busName -> { unsub:function, clientIds:Set<string> } */
  #busRegs

  constructor({ logger, buses }) {
    this.#logger = logger
    this.#buses = buses || {}
    this.#clients = new Map()
    this.#busRegs = new Map()

    this.#allowed = Object.keys(this.#buses).filter((name) => {
      const b = this.#buses[name]
      return b && typeof b.subscribe === 'function'
    })

    this.#defaultBus = this.#allowed.includes('main') ? 'main' : (this.#allowed[0] || null)
  }

  /**
   * Returns the list of allowed bus names (subscribe-capable).
   *
   * @returns {string[]}
   *
   * @example
   * const names = stream.getAllowedBuses()
   */
  getAllowedBuses() {
    return [...this.#allowed]
  }

  /**
   * Parse a uWebSockets query string into a selection object.
   * Unknown tokens are ignored.
   *
   * Accepted forms:
   * - '' -> default (main if available)
   * - 'main&button' -> { buses: ['main','button'] }
   * - 'all' or 'all&...' -> { mode: 'all' }
   *
   * @param {string} rawQuery
   * @returns {{ mode?: 'all', buses?: string[] }}
   *
   * @example
   * const select = stream.parseQuery('main&button')
   */
  parseQuery(rawQuery) {
    const tokens = String(rawQuery || '')
      .split('&')
      .map((t) => String(t || '').split('=')[0].trim())
      .filter(Boolean)

    if (tokens.includes('all')) {
      return { mode: 'all' }
    }

    const wanted = tokens.filter((t) => this.#allowed.includes(t))
    return { buses: wanted }
  }

  /**
   * Attach a client sink.
   *
   * @param {object} args
   * @param {string} args.id Stable client identifier
   * @param {{ mode?: 'all', buses?: string[] }} [args.select]
   * @param {function} args.onEvent Called as onEvent({ bus, event })
   *
   * @returns {function} detach function
   *
   * @example
   * const detach = stream.attachClient({
   *   id: 'cli',
   *   select: { mode: 'all' },
   *   onEvent: ({ bus, event }) => console.log(bus, event.type),
   * })
   * detach()
   */
  attachClient({ id, select, onEvent }) {
    const clientId = String(id || '').trim()
    if (!clientId) {
      const err = new Error('missing_client_id')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (typeof onEvent !== 'function') {
      const err = new Error('missing_onEvent')
      err.code = 'BAD_REQUEST'
      throw err
    }

    if (this.#clients.has(clientId)) {
      this.detachClient(clientId)
    }

    const wanted = new Set(this.#resolveSelection(select))

    this.#clients.set(clientId, { wanted, onEvent })

    for (const busName of wanted) {
      this.#ensureBusReg(busName)
      this.#busRegs.get(busName).clientIds.add(clientId)
    }

    this.#logger?.notice?.('busstream_client_attached', {
      clientId,
      buses: [...wanted],
    })

    return () => {
      this.detachClient(clientId)
    }
  }

  /**
   * Detach a previously attached client.
   *
   * @param {string} id
   *
   * @example
   * stream.detachClient('ws:1')
   */
  detachClient(id) {
    const clientId = String(id || '').trim()
    if (!clientId) {
      return
    }

    const client = this.#clients.get(clientId)
    if (!client) {
      return
    }

    this.#clients.delete(clientId)

    for (const busName of client.wanted) {
      const reg = this.#busRegs.get(busName)
      if (!reg) {
        continue
      }

      reg.clientIds.delete(clientId)

      if (reg.clientIds.size === 0) {
        try {
          reg.unsub()
        } catch (e) {
          // ignore
        }

        this.#busRegs.delete(busName)

        this.#logger?.debug?.('busstream_bus_unsubscribed', {
          bus: busName,
        })
      }
    }

    this.#logger?.notice?.('busstream_client_detached', { clientId })
  }

  /**
   * Dispose the stream and unsubscribe from all buses.
   *
   * @example
   * stream.dispose()
   */
  dispose() {
    for (const clientId of this.#clients.keys()) {
      this.detachClient(clientId)
    }

    for (const reg of this.#busRegs.values()) {
      try {
        reg.unsub()
      } catch (e) {
        // ignore
      }
    }

    this.#busRegs.clear()
    this.#clients.clear()
  }

  /* concise private bits */

  #resolveSelection(select) {
    if (!this.#allowed.length) {
      return []
    }

    const mode = select?.mode
    if (mode === 'all') {
      return [...this.#allowed]
    }

    const list = Array.isArray(select?.buses) ? select.buses : []
    const filtered = list.filter((b) => this.#allowed.includes(b))

    if (filtered.length) {
      return filtered
    }

    if (this.#defaultBus) {
      return [this.#defaultBus]
    }

    return [this.#allowed[0]]
  }

  #ensureBusReg(busName) {
    if (this.#busRegs.has(busName)) {
      return
    }

    const bus = this.#buses[busName]
    if (!bus || typeof bus.subscribe !== 'function') {
      return
    }

    const reg = {
      clientIds: new Set(),
      unsub: null,
    }

    reg.unsub = bus.subscribe((event) => {
      const r = this.#busRegs.get(busName)
      if (!r || r.clientIds.size === 0) {
        return
      }

      for (const clientId of r.clientIds) {
        const client = this.#clients.get(clientId)
        if (!client) {
          continue
        }

        try {
          client.onEvent({ bus: busName, event })
        } catch (e) {
          // ignore client handler errors
        }
      }
    })

    this.#busRegs.set(busName, reg)

    this.#logger?.debug?.('busstream_bus_subscribed', {
      bus: busName,
    })
  }
}

export default BusStream
