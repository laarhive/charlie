// src/transport/ws/wsRouter.js
export class WsRouter {
  #logger
  #streamHub

  constructor({ logger, streamHub }) {
    this.#logger = logger
    this.#streamHub = streamHub
  }

  register(app) {
    app.ws('/ws', {
      upgrade: (res, req, context) => {
        const secKey = req.getHeader('sec-websocket-key')
        const secProtocol = req.getHeader('sec-websocket-protocol')
        const secExtensions = req.getHeader('sec-websocket-extensions')

        const rawQuery = String(req.getQuery() || '')
        const isStream = rawQuery.trim().length > 0

        const select = isStream
          ? (this.#streamHub?.parseQuery ? this.#streamHub.parseQuery(rawQuery) : { buses: ['main'] })
          : null

        res.upgrade(
          {
            __mode: isStream ? 'stream' : 'rpc',
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
        if (ws.__mode === 'rpc') {
          this.#wsSend(ws, {
            type: 'ws:welcome',
            payload: { ok: true, features: { streaming: true, rpc: false }, note: 'rpc_not_supported_yet' },
          })

          try {
            ws.end(1008, 'rpc_not_supported')
          } catch (e) {
            // ignore
          }

          return
        }

        if (!this.#streamHub || typeof this.#streamHub.attachClient !== 'function') {
          this.#wsSend(ws, {
            type: 'ws:error',
            payload: { ok: false, error: 'stream_hub_unavailable' },
          })

          try {
            ws.end(1011, 'stream_hub_unavailable')
          } catch (e) {
            // ignore
          }

          return
        }

        const clientId = `ws_stream:${Date.now()}:${Math.random().toString(16).slice(2)}`
        ws.__clientId = clientId

        ws.__detachStream = this.#streamHub.attachClient({
          id: clientId,
          select: ws.__select,
          onEvent: ({ bus, event }) => {
            this.#wsSend(ws, { type: 'bus.event', payload: { bus, event } })
          },
        })

        this.#wsSend(ws, {
          type: 'ws:welcome',
          payload: { ok: true, features: { streaming: true } },
        })

        this.#logger.notice('ws_stream_open', { clientId, select: ws.__select })
      },

      close: (ws) => {
        this.#disposeStreamClient(ws)

        if (ws.__mode === 'stream') {
          this.#logger.notice('ws_stream_close', { clientId: ws.__clientId || null })
        }
      },

      message: () => {
        // stream: ignore inbound
        // rpc: unsupported (connection already closed)
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
}

export default WsRouter
