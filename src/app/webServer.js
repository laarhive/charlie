// src/app/webServer.js
import { createRequire } from 'node:module'
import eventTypes from '../core/eventTypes.js'
import uWS from 'uWebSockets.js'

const require = createRequire(import.meta.url)

/**
 * Web server hosting:
 * - simulated Tasker endpoints (/tasker/start, /tasker/stop)
 * - future REST API endpoints (/api/*)
 * - websocket endpoint (/ws) for future live taps + remote debugging
 *
 * @example
 * const server = new WebServer({ logger, buses, getStatus, getConfig, port: 8787 })
 * server.start()
 */
export class WebServer {
  #logger
  #buses
  #getStatus
  #getConfig
  #port
  #app
  #listeningToken
  #wsClients

  constructor({ logger, buses, getStatus, getConfig, port }) {
    this.#logger = logger
    this.#buses = buses
    this.#getStatus = getStatus
    this.#getConfig = getConfig
    this.#port = port

    this.#app = uWS.App()
    this.#listeningToken = null
    this.#wsClients = new Set()

    this.#registerRoutes()
  }

  /**
   * Starts listening.
   *
   * @example
   * server.start()
   */
  start() {
    if (this.#listeningToken) {
      return
    }

    this.#listeningToken = this.#app.listen(this.#port, (token) => {
      if (!token) {
        this.#logger.error('web_listen_failed', { port: this.#port })
        return
      }

      this.#logger.notice('web_listening', { port: this.#port })
    })
  }

  /**
   * Stops server (best-effort; uWS doesn't provide a full close API for all cases).
   *
   * @example
   * server.dispose()
   */
  dispose() {
    // uWebSockets.js listen token can be closed by calling us_listen_socket_close
    // but the binding differs per build; keeping best-effort minimal.
    this.#wsClients.clear()
  }

  /**
   * Broadcasts a JSON message to all websocket clients.
   *
   * @param {object} msg
   *
   * @example
   * server.broadcast({ type: 'hello', payload: {} })
   */
  broadcast(msg) {
    const data = JSON.stringify(msg)

    for (const ws of this.#wsClients) {
      try {
        ws.send(data)
      } catch (e) {
        // ignore broken clients
      }
    }
  }

  #registerRoutes() {
    this.#registerWs()
    this.#registerTaskerSim()
    this.#registerApi()
  }

  #registerWs() {
    this.#app.ws('/ws', {
      open: (ws) => {
        this.#wsClients.add(ws)
        ws.send(JSON.stringify({ type: 'ws:welcome', payload: { ok: true } }))
        this.#logger.notice('ws_open', { clients: this.#wsClients.size })
      },

      close: (ws) => {
        this.#wsClients.delete(ws)
        this.#logger.notice('ws_close', { clients: this.#wsClients.size })
      },

      message: (ws, message, isBinary) => {
        if (isBinary) {
          return
        }

        const text = Buffer.from(message).toString('utf8')
        this.#logger.debug('ws_message', { text })

        // Future:
        // - parse JSON
        // - accept remote debug commands
        // - enable tap streaming
        ws.send(JSON.stringify({ type: 'ws:echo', payload: { text } }))
      },
    })
  }

  #registerTaskerSim() {
    this.#app.post('/tasker/start', (res, req) => {
      this.#readJsonBody(res, (body) => {
        this.#buses.tasker.publish({
          type: eventTypes.tasker.req,
          ts: Date.now(),
          source: 'taskerSimServer',
          payload: {
            direction: 'inbound',
            action: 'start',
            body,
          },
        })

        this.#json(res, 200, { ok: true })
      })
    })

    this.#app.post('/tasker/stop', (res, req) => {
      this.#readJsonBody(res, (body) => {
        this.#buses.tasker.publish({
          type: eventTypes.tasker.req,
          ts: Date.now(),
          source: 'taskerSimServer',
          payload: {
            direction: 'inbound',
            action: 'stop',
            body,
          },
        })

        this.#json(res, 200, { ok: true })
      })
    })
  }

  #registerApi() {
    this.#app.get('/api/status', (res, req) => {
      const status = this.#getStatus()
      this.#json(res, 200, status)
    })

    this.#app.get('/api/config', (res, req) => {
      const cfg = this.#getConfig()
      this.#json(res, 200, cfg)
    })
  }

  #json(res, status, obj) {
    const body = JSON.stringify(obj, null, 2)

    res.writeStatus(`${status}`)
    res.writeHeader('content-type', 'application/json; charset=utf-8')
    res.end(body)
  }

  #readJsonBody(res, onDone) {
    let buf = ''

    res.onData((ab, isLast) => {
      buf += Buffer.from(ab).toString('utf8')

      if (!isLast) {
        return
      }

      let parsed = null

      try {
        parsed = buf ? JSON.parse(buf) : {}
      } catch (e) {
        this.#json(res, 400, { ok: false, error: 'invalid_json' })
        return
      }

      onDone(parsed)
    })

    res.onAborted(() => {
      // client disconnected, ignore
    })
  }
}

export default WebServer
