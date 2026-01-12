import assert from 'node:assert/strict'
import CliWsController from '../src/cli/cliWsController.js'

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

const makeFakeClient = function makeFakeClient() {
  const calls = []

  return {
    calls,

    connect: async () => {},

    onBusEvent: () => () => {},

    request: async (type, payload = {}) => {
      calls.push({ type, payload })

      if (type === 'state.get') {
        return { injectEnabled: false }
      }

      if (type === 'config.get') {
        return {
          sensors: [
            { id: 'presence_front', enabled: true, role: 'presence', zone: 'front' },
            { id: 'vib_heavy', enabled: true, role: 'vibration', level: 'heavy' },
            { id: 'btn_main', enabled: true, role: 'button' },
          ]
        }
      }

      if (type === 'driver.list') {
        return {
          drivers: [
            { id: 'presence_front', role: 'presence', type: 'ld2410', bus: 'presence', enabled: true, started: true }
          ]
        }
      }

      if (type === 'inject.enable') {
        return { injectEnabled: true }
      }

      if (type === 'inject.disable') {
        return { injectEnabled: false }
      }

      if (type === 'bus.tap.start') {
        return { subId: 'main:1:abc' }
      }

      if (type === 'bus.tap.stop') {
        return { ok: true }
      }

      return { ok: true }
    }
  }
}

describe('CliWsController WS request mapping', function () {
  it('inject status pulls from state.get', async function () {
    const client = makeFakeClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example/ws',
      client,
    })

    await cli.handleCommand({ kind: 'injectStatus' })

    assert.equal(client.calls[0].type, 'state.get')
  })

  it('presence front on injects presence:enter to main bus', async function () {
    const client = makeFakeClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example/ws',
      client,
    })

    await cli.handleCommand({ kind: 'injectOn' })
    await cli.handleCommand({ kind: 'presence', zone: 'front', present: true })

    const injectCall = client.calls.find((c) => c.type === 'inject.event')
    assert.ok(injectCall)

    assert.equal(injectCall.payload.bus, 'main')
    assert.equal(injectCall.payload.type, 'presence:enter')
    assert.equal(injectCall.payload.payload.zone, 'front')
    assert.equal(injectCall.payload.payload.sensorId, 'presence_front')
  })

  it('driver disable sends driver.disable with sensorId', async function () {
    const client = makeFakeClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example/ws',
      client,
    })

    await cli.handleCommand({ kind: 'driverDisable', sensorId: 'presence_front' })

    const call = client.calls.find((c) => c.type === 'driver.disable')
    assert.ok(call)
    assert.equal(call.payload.sensorId, 'presence_front')
  })

  it('tap main on sends bus.tap.start', async function () {
    const client = makeFakeClient()

    const cli = new CliWsController({
      logger: makeLogger(),
      parser: { parse: () => ({ kind: 'empty' }) },
      wsUrl: 'ws://example/ws',
      client,
    })

    await cli.handleCommand({ kind: 'tapOn', bus: 'main' })

    const call = client.calls.find((c) => c.type === 'bus.tap.start')
    assert.ok(call)
    assert.equal(call.payload.bus, 'main')
  })
})
