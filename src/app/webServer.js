// src/app/webServer.js
import eventTypes from '../core/eventTypes.js'
import uWS from 'uWebSockets.js'

/**
 * Web server hosting:
 * - simulated Tasker endpoints (/tasker/start, /tasker/stop)
 * - REST API endpoints (/api/*)
 * - websocket endpoint (/ws) for live taps + remote CLI/WebUI control
 *
 * @example
 * const server = new WebServer({
 *   logger,
 *   buses,
 *   getStatus,
 *   getConfig,
 *   control, // optional
 *   port: 8787
 * })
 * server.start()
 */
export class WebServer {
  #logger
  #buses
  #getStatus
  #getConfig
  #control
  #port
  #app
  #listeningToken
  #wsClients

  constructor({ logger, buses, getStatus, getConfig, control, port }) {
    this.#logger = logger
    this.#buses = buses
    this.#getStatus = getStatus
    this.#getConfig = getConfig
    this.#control = control ?? null
    this.#port = port

    this.#app = uWS.App()
    this.#listeningToken = null
    this.#wsClients = new Set()

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
    for (const ws of this.#wsClients) {
      this.#disposeClient(ws)
    }

    this.#wsClients.clear()
  }

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

        /* per-client subscription registry */
        ws.__subs = new Map()

        ws.send(JSON.stringify({
          type: 'ws:welcome',
          payload: {
            ok: true,
            features: {
              rpc: true,
              taps: true
            }
          }
        }))

        this.#logger.notice('ws_open', { clients: this.#wsClients.size })
      },

      close: (ws) => {
        this.#disposeClient(ws)
        this.#wsClients.delete(ws)
        this.#logger.notice('ws_close', { clients: this.#wsClients.size })
      },

      message: async (ws, message, isBinary) => {
        if (isBinary) {
          return
        }

        const text = Buffer.from(message).toString('utf8')

        let req = null
        try {
          req = JSON.parse(text)
        } catch (e) {
          this.#wsSend(ws, this.#rpcErr({
            id: null,
            type: 'error',
            message: 'invalid_json',
            code: 'BAD_JSON'
          }))

          return
        }

        const res = await this.#handleWsRpc(ws, req)
        if (res) {
          this.#wsSend(ws, res)
        }
      }
    })
  }

  async #handleWsRpc(ws, req) {
    const id = req?.id ?? null
    const type = req?.type
    const payload = req?.payload ?? {}

    if (!type) {
      return this.#rpcErr({
        id,
        type: 'error',
        message: 'missing_type',
        code: 'BAD_REQUEST'
      })
    }

    try {
      if (type === 'state.get') {
        const status = this.#getStatus?.() ?? {}
        const ctrl = this.#control?.getSnapshot ? this.#control.getSnapshot() : {}
        return this.#rpcOk({ id, type, payload: { ...status, ...ctrl } })
      }

      if (type === 'config.get') {
        const cfg = this.#getConfig?.() ?? {}
        return this.#rpcOk({ id, type, payload: cfg })
      }

      if (type === 'bus.tap.start') {
        const out = this.#tapStart(ws, payload)
        return this.#rpcOk({ id, type, payload: out })
      }

      if (type === 'bus.tap.stop') {
        const out = this.#tapStop(ws, payload)
        return this.#rpcOk({ id, type, payload: out })
      }

      if (type === 'inject.enable') {
        if (!this.#control?.injectEnable) {
          return this.#rpcErr({
            id,
            type,
            message: 'inject_not_supported',
            code: 'NOT_SUPPORTED'
          })
        }

        const out = await this.#control.injectEnable()
        return this.#rpcOk({ id, type, payload: out })
      }

      if (type === 'inject.disable') {
        if (!this.#control?.injectDisable) {
          return this.#rpcErr({
            id,
            type,
            message: 'inject_not_supported',
            code: 'NOT_SUPPORTED'
          })
        }

        const out = await this.#control.injectDisable()
        return this.#rpcOk({ id, type, payload: out })
      }

      if (type === 'inject.event') {
        if (!this.#control?.injectEvent) {
          return this.#rpcErr({
            id,
            type,
            message: 'inject_not_supported',
            code: 'NOT_SUPPORTED'
          })
        }

        const out = await this.#control.injectEvent(payload)
        return this.#rpcOk({ id, type, payload: out })
      }

      /*
        Optional pass-through for anything else.
        This lets you add driver.list/enable/disable without touching WebServer again.
      */
      if (this.#control?.handleWsRequest) {
        const out = await this.#control.handleWsRequest({ id, type, payload })
        if (out) {
          return out
        }
      }

      return this.#rpcErr({
        id,
        type,
        message: `unknown_type:${type}`,
        code: 'UNKNOWN_TYPE'
      })
    } catch (e) {
      return this.#rpcErr({
        id,
        type,
        message: e?.message ?? 'internal_error',
        code: e?.code ?? 'INTERNAL_ERROR'
      })
    }
  }

  #tapStart(ws, payload) {
    const busName = payload?.bus
    const filter = payload?.filter ?? {}

    if (!busName) {
      const err = new Error('missing_bus')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const bus = this.#buses?.[busName]
    if (!bus?.subscribe) {
      const err = new Error(`unknown_bus:${busName}`)
      err.code = 'BUS_NOT_FOUND'
      throw err
    }

    const subId = `${busName}:${Date.now()}:${Math.random().toString(16).slice(2)}`
    const unsub = bus.subscribe((evt) => {
      if (filter?.typePrefix && typeof evt?.type === 'string') {
        if (!evt.type.startsWith(filter.typePrefix)) {
          return
        }
      }

      this.#wsSend(ws, {
        type: 'bus.event',
        payload: {
          subId,
          bus: busName,
          event: evt
        }
      })
    })

    ws.__subs.set(subId, unsub)

    return { subId }
  }

  #tapStop(ws, payload) {
    const subId = payload?.subId
    if (!subId) {
      const err = new Error('missing_subId')
      err.code = 'BAD_REQUEST'
      throw err
    }

    const unsub = ws.__subs?.get(subId)
    if (!unsub) {
      const err = new Error(`unknown_sub:${subId}`)
      err.code = 'SUB_NOT_FOUND'
      throw err
    }

    unsub()
    ws.__subs.delete(subId)

    return { ok: true }
  }

  #disposeClient(ws) {
    if (!ws?.__subs) {
      return
    }

    for (const unsub of ws.__subs.values()) {
      try {
        unsub()
      } catch (e) {
        // ignore
      }
    }

    ws.__subs.clear()
  }

  #rpcOk({ id, type, payload }) {
    return {
      id,
      ok: true,
      type,
      payload
    }
  }

  #rpcErr({ id, type, message, code }) {
    return {
      id,
      ok: false,
      type,
      error: {
        message,
        code
      }
    }
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
          payload: {
            direction: 'inbound',
            action: 'start',
            body
          }
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
            body
          }
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
