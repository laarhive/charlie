/**
 * CliWsController unit tests (RPC + streaming).
 *
 * This test suite validates the behavior of `CliWsController` in isolation,
 * ensuring correct interaction with its RPC and streaming clients.
 *
 * Scope:
 * - In-process unit tests (no real WebSocket connections)
 * - Fake RPC and stream clients used as spies
 * - No Charlie daemon process
 *
 * What is tested:
 * - RPC request mapping:
 *   - inject status (`state.get`)
 *   - inject enable / disable
 *   - semantic injection commands (`inject.event`)
 *
 * - Streaming hookup:
 *   - registration of a bus stream handler
 *   - stable formatting of streamed `bus.event` output
 *
 * What is not tested:
 * - WebSocket transport
 * - Server-side behavior or validation
 * - Bus selection via URL query params
 *
 * Notes:
 * - Assumes modern WS split:
 *   - RPC on `/rpc`
 *   - streaming on `/ws?...`
 * - No legacy driver or tap APIs exist.
 *
 * These tests protect the CLI’s public behavior while allowing
 * internal refactors without breaking user-facing semantics.
 */
import assert from 'node:assert/strict'
import CliWsController from '../../src/cli/cliWsController.js'

const makeLogger = function makeLogger() {
  const noop = () => {}
  return {
    debug: noop,
    info: noop,
    notice: noop,
    warning: noop,
    error: noop,
  }
}

const makeFakeRpcClient = function makeFakeRpcClient() {
  const calls = []

  return {
    calls,

    connect: async () => {},

    request: async (type, payload = {}) => {
      calls.push({ type, payload })

      if (type === 'state.get') {
        return { injectEnabled: false }
      }

      if (type === 'config.get') {
        return {
          core: {
            injectDefaults: {
              presenceFront: 'presence_front',
              presenceBack: 'presence_back',
              vibrationHigh: 'vib_heavy',
              vibrationLow: 'vib_light',
              buttonShort: 'btn_main',
              buttonLong: 'btn_main',
            },
          },
          devices: [],
        }
      }

      if (type === 'inject.enable') {
        return { injectEnabled: true }
      }

      if (type === 'inject.disable') {
        return { injectEnabled: false }
      }

      return { ok: true }
    }
  }
}

const makeFakeStreamClient = function makeFakeStreamClient() {
  let handler = null

  return {
    connect: async () => {},

    onBusEvent: (fn) => {
      handler = fn
      return () => {}
    },

    getHandler: () => handler,
  }
}

describe('CliWsController RPC request mapping', function () {
  it('inject status pulls from state.get', async function () {
    const rpcClient = makeFakeRpcClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example',
      rpcClient,
      streamClient: makeFakeStreamClient(),
    })

    await cli.handleCommand({ kind: 'injectStatus' })

    assert.equal(rpcClient.calls[0].type, 'state.get')
  })

  it('presence front on injects presence:enter to main bus', async function () {
    const rpcClient = makeFakeRpcClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example',
      rpcClient,
      streamClient: makeFakeStreamClient(),
    })

    await cli.init()

    await cli.handleCommand({ kind: 'injectOn' })
    await cli.handleCommand({ kind: 'presence', zone: 'front', present: true })

    const injectCall = rpcClient.calls.find((c) => c.type === 'inject.event')
    assert.ok(injectCall)

    assert.equal(injectCall.payload.bus, 'main')
    assert.equal(injectCall.payload.type, 'presence:enter')
    assert.equal(injectCall.payload.payload.zone, 'front')
    assert.equal(injectCall.payload.payload.coreRole, 'presence_front')
  })
})

describe('CliWsController streaming hookup', function () {
  it('init attaches a stream handler', async function () {
    const streamClient = makeFakeStreamClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example',
      rpcClient: makeFakeRpcClient(),
      streamClient,
    })

    await cli.init()

    assert.ok(typeof streamClient.getHandler() === 'function')
  })

  it('prints bus.event lines in stable format', async function () {
    const streamClient = makeFakeStreamClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example',
      rpcClient: makeFakeRpcClient(),
      streamClient,
    })

    await cli.init()

    const h = streamClient.getHandler()
    assert.ok(h)

    const lines = []
    const original = console.log
    console.log = (...args) => lines.push(args.join(' '))

    try {
      h({ bus: 'main', event: { type: 'presence:enter' } })
    } finally {
      console.log = original
    }

    assert.equal(lines.length, 1)
    assert.ok(lines[0].includes('[stream main]'))
    assert.ok(lines[0].includes('presence:enter'))
  })
})
