// src/transport/webServer.js
import uWS from 'uWebSockets.js'
import { fileURLToPath } from 'node:url'
import serveStaticFiles from './serveStaticFiles.js'
import eventTypes from '../core/eventTypes.js'

/**
 * Web server hosting:
 * - static files (/*)
 * - simulated Tasker endpoints (/tasker/start, /tasker/stop)
 * - REST API endpoints (/api/*)
 * - websocket endpoint (/ws) for bus streaming (server-push only)
 *
 * Notes:
 * - This server exposes streaming only (observability).
 * - Control is performed locally via the interactive CLI (`--interactive`).
 * - A separate WS RPC endpoint may be added later for a Web UI.
 */
export class WebServer {
  #logger
  #buses
  #busStream
  #port
  #app
  #listeningToken
  #wsStreamClients
  #publicRoot

  constructor({ logger, buses, busStream, port }) {
    this.#logger = logger
    this.#buses = buses
    this.#busStream = busStream
    this.#port = port

    this.#app = uWS.App()
    this.#listeningToken = null
    this.#wsStreamClients = new Set()
    this.#publicRoot = fileURLToPath(new URL('../../public', import.meta.url))

    this.#registerRoutes()
  }

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

  dispose() {
    for (const ws of this.#wsStreamClients) {
      this.#disposeStreamClient(ws)
    }

    this.#wsStreamClients.clear()

    if (this.#listeningToken && typeof uWS.us_listen_socket_close === 'function') {
      try {
        uWS.us_listen_socket_close(this.#listeningToken)
      } catch (e) {
        // ignore
      }
    }

    this.#listeningToken = null
  }

  #registerRoutes() {
    this.#registerStatic()
    this.#registerWsStream()
    this.#registerTaskerSim()
    this.#registerApi()
  }

  #registerStatic() {
    this.#app.get('/*', (res, req) => {
      serveStaticFiles(res, req, {
        publicRoot: this.#publicRoot,
        log: this.#logger,
        me: 'charlie',
      })
    })
  }

  #registerWsStream() {
    this.#app.ws('/ws', {
      upgrade: (res, req, context) => {
        const secKey = req.getHeader('sec-websocket-key')
        const secProtocol = req.getHeader('sec-websocket-protocol')
        const secExtensions = req.getHeader('sec-websocket-extensions')

        const rawQuery = req.getQuery()
        const select = this.#busStream?.parseQuery
          ? this.#busStream.parseQuery(rawQuery)
          : { buses: ['main'] }

        res.upgrade(
          {
            __select: select,
            __detachStream: null,
            __clientId: null,
          },
          secKey,
          secProtocol,
          secExtensions,
          context
        )
      },

      open: (ws) => {
        this.#wsStreamClients.add(ws)

        const clientId = `ws_stream:${Date.now()}:${Math.random().toString(16).slice(2)}`
        ws.__clientId = clientId

        if (this.#busStream?.attachClient) {
          ws.__detachStream = this.#busStream.attachClient({
            id: clientId,
            select: ws.__select,
            onEvent: ({ bus, event }) => {
              this.#wsSend(ws, { type: 'bus.event', payload: { bus, event } })
            },
          })
        }

        this.#wsSend(ws, {
          type: 'ws:welcome',
          payload: { ok: true, features: { streaming: true } },
        })

        this.#logger.notice('ws_stream_open', {
          clients: this.#wsStreamClients.size,
          clientId,
          select: ws.__select,
        })
      },

      close: (ws) => {
        this.#disposeStreamClient(ws)
        this.#wsStreamClients.delete(ws)
        this.#logger.notice('ws_stream_close', { clients: this.#wsStreamClients.size })
      },

      message: (ws, message, isBinary) => {
        // streaming endpoint: ignore inbound traffic
      },
    })
  }

  #disposeStreamClient(ws) {
    if (typeof ws?.__detachStream === 'function') {
      try {
        ws.__detachStream()
      } catch (e) {
        // ignore
      }
    }

    ws.__detachStream = null
    ws.__select = null
    ws.__clientId = null
  }

  #wsSend(ws, msg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch (e) {
      // ignore
    }
  }

  #registerTaskerSim() {
    this.#app.post('/tasker/start', (res, req) => {
      this.#readJsonBody(res, (body) => {
        this.#buses.tasker.publish({
          type: eventTypes.tasker.req,
          ts: Date.now(),
          source: 'taskerSimServer',
          payload: { direction: 'inbound', action: 'start', body },
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
          payload: { direction: 'inbound', action: 'stop', body },
        })

        this.#json(res, 200, { ok: true })
      })
    })
  }

  #registerApi() {
    this.#app.get('/api/status', (res, req) => {
      this.#json(res, 200, { ok: true })
    })

    this.#app.get('/api/config', (res, req) => {
      this.#json(res, 200, { ok: true })
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
