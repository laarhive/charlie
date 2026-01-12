import assert from 'node:assert/strict'
import WebSocket from 'ws'

import EventBus from '../src/core/eventBus.js'
import WebServer from '../src/app/webServer.js'

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

const waitFor = function waitFor(fn, timeoutMs = 1000) {
  const start = Date.now()

  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const v = fn()
        if (v) {
          resolve(v)
          return
        }
      } catch (e) {
        reject(e)
        return
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error('timeout'))
        return
      }

      setTimeout(tick, 10)
    }

    tick()
  })
}

const wsRequest = async function wsRequest(ws, type, payload = {}) {
  const id = `${Date.now()}:${Math.random().toString(16).slice(2)}`

  ws.send(JSON.stringify({ id, type, payload }))

  const res = await waitFor(() => {
    const msg = ws.__msgs.find((m) => m?.id === id)
    return msg ?? null
  }, 1000)

  return res
}

describe('WS API (WebServer)', function () {
  this.timeout(5000)

  let server
  let port
  let buses
  let control

  beforeEach(async function () {
    port = 18000 + Math.floor(Math.random() * 2000)

    buses = {
      main: new EventBus(),
      presence: new EventBus(),
      vibration: new EventBus(),
      button: new EventBus(),
      tasker: new EventBus(),
    }

    let injectEnabled = false
    const drivers = [
      {
        getSensorId: () => 'presence_front',
        getRole: () => 'presence',
        getType: () => 'ld2410',
        getBus: () => 'presence',
        isEnabled: () => true,
        isStarted: () => true,
        setEnabled: () => {}
      }
    ]

    control = {
      getSnapshot: () => ({ injectEnabled }),

      injectEnable: async () => {
        injectEnabled = true
        return { injectEnabled }
      },

      injectDisable: async () => {
        injectEnabled = false
        return { injectEnabled }
      },

      injectEvent: async ({ bus, type, payload, source }) => {
        if (!injectEnabled) {
          const err = new Error('inject_disabled')
          err.code = 'INJECT_DISABLED'
          throw err
        }

        const target = buses[bus]
        if (!target) {
          const err = new Error('unknown_bus')
          err.code = 'BUS_NOT_FOUND'
          throw err
        }

        target.publish({ type, ts: Date.now(), source: source ?? 'test', payload: payload ?? {} })
        return { ok: true }
      },

      handleWsRequest: async ({ id, type, payload }) => {
        if (type === 'driver.list') {
          return {
            id,
            ok: true,
            type,
            payload: {
              drivers: drivers.map((d) => ({
                id: d.getSensorId(),
                role: d.getRole(),
                type: d.getType(),
                bus: d.getBus(),
                enabled: d.isEnabled(),
                started: d.isStarted(),
              }))
            }
          }
        }

        if (type === 'driver.disable') {
          assert.equal(payload.sensorId, 'presence_front')
          return { id, ok: true, type, payload: { ok: true } }
        }

        if (type === 'driver.enable') {
          assert.equal(payload.sensorId, 'presence_front')
          return { id, ok: true, type, payload: { ok: true } }
        }

        return null
      }
    }

    server = new WebServer({
      logger: makeLogger(),
      buses,
      getStatus: () => ({ state: 'IDLE' }),
      getConfig: () => ({ server: { port } }),
      control,
      port,
    })

    server.start()
  })

  afterEach(function () {
    server.dispose()
  })

  it('state.get returns core status and injectEnabled', async function () {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.__msgs = []

    ws.on('message', (raw) => {
      ws.__msgs.push(JSON.parse(raw.toString()))
    })

    await new Promise((resolve) => ws.once('open', resolve))

    const res = await wsRequest(ws, 'state.get')

    assert.equal(res.ok, true)
    assert.equal(res.type, 'state.get')
    assert.equal(res.payload.state, 'IDLE')
    assert.equal(res.payload.injectEnabled, false)

    ws.close()
  })

  it('config.get returns config', async function () {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.__msgs = []
    ws.on('message', (raw) => ws.__msgs.push(JSON.parse(raw.toString())))

    await new Promise((resolve) => ws.once('open', resolve))

    const res = await wsRequest(ws, 'config.get')

    assert.equal(res.ok, true)
    assert.equal(res.payload.server.port, port)

    ws.close()
  })

  it('driver.list is routed via control.handleWsRequest', async function () {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.__msgs = []
    ws.on('message', (raw) => ws.__msgs.push(JSON.parse(raw.toString())))

    await new Promise((resolve) => ws.once('open', resolve))

    const res = await wsRequest(ws, 'driver.list')

    assert.equal(res.ok, true)
    assert.equal(Array.isArray(res.payload.drivers), true)
    assert.equal(res.payload.drivers[0].id, 'presence_front')
    assert.equal(res.payload.drivers[0].started, true)

    ws.close()
  })

  it('bus.tap.start streams bus.event', async function () {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.__msgs = []
    ws.on('message', (raw) => ws.__msgs.push(JSON.parse(raw.toString())))

    await new Promise((resolve) => ws.once('open', resolve))

    const startRes = await wsRequest(ws, 'bus.tap.start', { bus: 'main' })
    assert.equal(startRes.ok, true)
    assert.ok(startRes.payload.subId)

    buses.main.publish({ type: 'presence:enter', ts: 1, source: 'test', payload: { zone: 'front' } })

    const evt = await waitFor(() => {
      return ws.__msgs.find((m) => m?.type === 'bus.event' && m?.payload?.event?.type === 'presence:enter') ?? null
    }, 1000)

    assert.equal(evt.payload.bus, 'main')

    ws.close()
  })

  it('inject.event is blocked until inject.enable', async function () {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.__msgs = []
    ws.on('message', (raw) => ws.__msgs.push(JSON.parse(raw.toString())))

    await new Promise((resolve) => ws.once('open', resolve))

    const blocked = await wsRequest(ws, 'inject.event', { bus: 'main', type: 'presence:enter' })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error.code, 'INJECT_DISABLED')

    const enabled = await wsRequest(ws, 'inject.enable')
    assert.equal(enabled.ok, true)

    const ok = await wsRequest(ws, 'inject.event', { bus: 'main', type: 'presence:enter' })
    assert.equal(ok.ok, true)

    ws.close()
  })
})
