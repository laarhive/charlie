// src/transport/http/httpRouter.js
import makeHttpIo from './httpIo.js'

export class HttpRouter {
  #httpIo
  #api
  #enableDev
  #enableTestHooks

  constructor({ api, enableDev, enableTestHooks }) {
    this.#httpIo = makeHttpIo()
    this.#api = api
    this.#enableDev = Boolean(enableDev)
    this.#enableTestHooks = Boolean(enableTestHooks)
  }

  register(app) {
    app.get('/api/v1/status', (res, req) => {
      this.#httpIo.json(res, 200, { ok: true })
    })

    app.get('/api/v1/config', (res, req) => {
      this.#httpIo.json(res, 200, { ok: true, data: this.#api.getConfig() })
    })

    app.post('/api/v1/recording', (res, req) => {
      this.#httpIo.readJsonBody(res, async (body) => {
        try {
          const data = await this.#api.recording(body)
          this.#httpIo.json(res, 200, { ok: true, data })
        } catch (e) {
          const code = String(e?.code || 'ERROR')
          this.#httpIo.json(res, 400, { ok: false, error: code })
        }
      })
    })

    if (this.#enableDev) {
      this.#registerDev(app)
    }
  }

  #registerDev(app) {
    app.post('/api/v1/dev/tasker/start', (res, req) => {
      this.#httpIo.readJsonBody(res, (body) => {
        this.#api.taskerSimStart(body)
        this.#httpIo.json(res, 200, { ok: true })
      })
    })

    app.post('/api/v1/dev/tasker/stop', (res, req) => {
      this.#httpIo.readJsonBody(res, (body) => {
        this.#api.taskerSimStop(body)
        this.#httpIo.json(res, 200, { ok: true })
      })
    })

    if (this.#enableTestHooks) {
      this.#registerTestHooks(app)
    }
  }

  #registerTestHooks(app) {
    app.post('/api/v1/dev/publish', (res, req) => {
      this.#httpIo.readJsonBody(res, (body) => {
        try {
          this.#api.testPublish({ bus: body?.bus, event: body?.event })
        } catch (e) {
          const code = String(e?.code || 'ERROR')
          this.#httpIo.json(res, 400, { ok: false, error: code })
          return
        }

        this.#httpIo.json(res, 200, { ok: true })
      })
    })
  }
}

export default HttpRouter
