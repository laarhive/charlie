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
          ? (this.#streamHub?.parseQuery
            ? this.#streamHub.parseQuery(rawQuery)
            : { buses: ['main'] })
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
            payload: {
              ok: true,
              features: { rpc: false, streaming: false },
              note: 'rpc_not_supported_yet',
            },
          })

          try {
            ws.end(1008, 'rpc_not_supported')
          } catch (e) {
            // ignore
          }

          return
        }

        const clientId = `ws_stream:${Date.now()}:${Math.random().toString(16).slice(2)}`
        ws.__clientId = clientId

        try {
          ws.__detachStream = this.#streamHub.attachClient({
            id: clientId,
            select: ws.__select,
            onEvent: ({ bus, event }) => {
              this.#wsSend(ws, { type: 'bus.event', payload: { bus, event } })
            },
          })
        } catch (e) {
          this.#logger?.error?.('ws_stream_attach_failed', {
            clientId,
            error: String(e?.message || e),
            code: e?.code || null,
            select: ws.__select,
          })

          this.#wsSend(ws, {
            type: 'ws:error',
            payload: { ok: false, error: String(e?.code || 'ATTACH_FAILED') },
          })

          try {
            ws.end(1011, 'attach_failed')
          } catch (err) {
            // ignore
          }

          return
        }

        this.#wsSend(ws, {
          type: 'ws:welcome',
          payload: { ok: true, features: { streaming: true } },
        })

        this.#logger.notice('ws_stream_open', { clientId, select: ws.__select })
      },

      close: (ws) => {
        const mode = ws.__mode
        const clientId = ws.__clientId || null

        this.#disposeStreamClient(ws)

        if (mode === 'stream') {
          this.#logger.notice('ws_stream_close', { clientId })
        }
      },

      message: (ws, message, isBinary) => {
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
