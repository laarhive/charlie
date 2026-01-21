// src/app/wsRpcHandlers.js

/**
 * Creates the default RPC handler chain used by /rpc.
 *
 * Includes:
 * - state.get
 * - config.get
 * - inject.*
 * - passthrough: control.handleWsRequest
 *
 * @example
 * const handlers = makeWsRpcHandlers({ getStatus, getConfig, control, ok, err })
 * handlers.forEach((h) => router.use(h))
 */
export const makeWsRpcHandlers = function makeWsRpcHandlers({ getStatus, getConfig, control, ok, err }) {
  const handlers = []

  handlers.push(async ({ id, type }) => {
    if (type !== 'state.get') {
      return null
    }

    const status = getStatus?.() ?? {}
    const ctrl = control?.getSnapshot ? control.getSnapshot() : {}
    return ok({ id, type, payload: { ...status, ...ctrl } })
  })

  handlers.push(async ({ id, type }) => {
    if (type !== 'config.get') {
      return null
    }

    const cfg = getConfig?.() ?? {}
    return ok({ id, type, payload: cfg })
  })

  handlers.push(async ({ id, type }) => {
    if (type !== 'inject.enable') {
      return null
    }

    if (!control?.injectEnable) {
      return err({ id, type, message: 'inject_not_supported', code: 'NOT_SUPPORTED' })
    }

    const out = await control.injectEnable()
    return ok({ id, type, payload: out })
  })

  handlers.push(async ({ id, type }) => {
    if (type !== 'inject.disable') {
      return null
    }

    if (!control?.injectDisable) {
      return err({ id, type, message: 'inject_not_supported', code: 'NOT_SUPPORTED' })
    }

    const out = await control.injectDisable()
    return ok({ id, type, payload: out })
  })

  handlers.push(async ({ id, type, payload }) => {
    if (type !== 'inject.event') {
      return null
    }

    if (!control?.injectEvent) {
      return err({ id, type, message: 'inject_not_supported', code: 'NOT_SUPPORTED' })
    }

    const out = await control.injectEvent(payload)
    return ok({ id, type, payload: out })
  })

  handlers.push(async ({ id, type, payload }) => {
    if (!control?.handleWsRequest) {
      return null
    }

    const out = await control.handleWsRequest({ id, type, payload })
    return out || null
  })

  return handlers
}

export default makeWsRpcHandlers
