// src/app/wsRpcRouter.js

/**
 * WebSocket RPC router.
 *
 * Responsibilities:
 * - validate basic RPC envelope
 * - dispatch to registered handlers
 * - provide consistent ok/error responses
 *
 * Handlers are evaluated in order. First non-null result wins.
 *
 * @example
 * const router = new WsRpcRouter({ logger })
 * router.use(async ({ id, type, payload }) => ({ id, ok: true, type, payload: {} }))
 */
export class WsRpcRouter {
  #logger
  #handlers

  constructor({ logger }) {
    this.#logger = logger
    this.#handlers = []
  }

  /**
   * Register a handler.
   *
   * Handler signature:
   *   async ({ id, type, payload }) => response | null
   *
   * @param {function} handler
   *
   * @example
   * router.use(async ({ type }) => type === 'ping' ? { id, ok: true, type, payload: {} } : null)
   */
  use(handler) {
    if (typeof handler !== 'function') {
      return
    }

    this.#handlers.push(handler)
  }

  /**
   * Handle a request.
   *
   * @param {object} req
   * @returns {object} rpc response
   *
   * @example
   * const res = await router.handle({ id: '1', type: 'state.get', payload: {} })
   */
  async handle(req) {
    const id = req?.id ?? null
    const type = req?.type
    const payload = req?.payload ?? {}

    if (!type) {
      return this.#rpcErr({ id, type: 'error', message: 'missing_type', code: 'BAD_REQUEST' })
    }

    try {
      for (const h of this.#handlers) {
        const out = await h({ id, type, payload })
        if (out) {
          return out
        }
      }

      return this.#rpcErr({
        id,
        type,
        message: `unknown_type:${type}`,
        code: 'UNKNOWN_TYPE',
      })
    } catch (e) {
      return this.#rpcErr({
        id,
        type,
        message: e?.message ?? 'internal_error',
        code: e?.code ?? 'INTERNAL_ERROR',
      })
    }
  }

  #rpcOk({ id, type, payload }) {
    return { id, ok: true, type, payload }
  }

  #rpcErr({ id, type, message, code }) {
    return { id, ok: false, type, error: { message, code } }
  }

  /*
    Helper factory so other modules can build handlers without
    re-implementing rpcOk/rpcErr everywhere.
  */
  makeOk() {
    return ({ id, type, payload }) => this.#rpcOk({ id, type, payload })
  }

  makeErr() {
    return ({ id, type, message, code }) => this.#rpcErr({ id, type, message, code })
  }
}

export default WsRpcRouter
