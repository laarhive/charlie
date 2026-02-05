// src/transport/webServer.js
import uWS from 'uWebSockets.js'
import { fileURLToPath } from 'node:url'
import serveStaticFiles from './serveStaticFiles.js'

import HttpRouter from './http/httpRouter.js'
import WsRouter from './ws/wsRouter.js'

export class WebServer {
  #logger
  #port
  #app
  #listeningToken
  #publicRoot

  #httpRouter
  #wsRouter

  constructor({ logger, port, api, streamHub }) {
    this.#logger = logger
    this.#port = port

    this.#app = uWS.App()
    this.#listeningToken = null
    this.#publicRoot = fileURLToPath(new URL('../../public', import.meta.url))

    const enableDev = true
    const enableTestHooks = String(process.env.CHARLIE_TEST || '').trim() === '1'

    this.#httpRouter = new HttpRouter({
      api,
      enableDev,
      enableTestHooks,
    })

    this.#wsRouter = new WsRouter({
      logger,
      streamHub,
    })

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

    this.#wsRouter.register(this.#app)
    this.#httpRouter.register(this.#app)
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
}

export default WebServer
