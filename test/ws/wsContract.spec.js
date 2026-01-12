/**
 * WS API contract tests (process-level integration).
 *
 * This test suite validates the complete WebSocket RPC surface exposed by
 * a running Charlie daemon, started via `appRunner` in `virt` mode.
 *
 * Scope:
 * - Spawns the real application as a separate Node.js process
 * - Uses the real uWebSockets.js server
 * - Communicates exclusively through the public WS RPC protocol
 * - Makes no assumptions about internal implementation details
 *
 * What is tested:
 * - Core RPC endpoints:
 *   - state.get
 *   - config.get
 * - Injection control:
 *   - inject.enable / inject.disable
 *   - inject.event (allowed vs blocked)
 * - Driver management:
 *   - driver.list
 *   - driver.enable / driver.disable
 * - Bus taps:
 *   - bus.tap.start
 *   - bus.tap.stop
 *   - streaming of bus.event messages
 * - Error handling:
 *   - unknown RPC types
 *   - invalid JSON payloads
 *
 * Guarantees provided by this suite:
 * - The WS API behaves correctly from a client’s perspective
 * - The protocol is stable and backward-compatible
 * - All RPCs work against a fully initialized runtime (drivers, buses, core)
 *
 * Non-goals:
 * - Does NOT unit-test internal modules (those are covered elsewhere)
 * - Does NOT mock buses, drivers, or controllers
 * - Does NOT require real hardware
 *
 * Why this matters:
 * This suite acts as a contract for all future clients:
 * - CLI (local or remote)
 * - Web UI
 * - Tasker / mobile integrations
 *
 * If a change breaks these tests, it is a breaking API change.
 */

import assert from 'node:assert/strict'

import {
  assertDaemonAlive,
  connectWs,
  getFreePort,
  startCharlieDaemon,
  stopCharlie,
  waitFor,
  waitForWsReady,
  wsRequest
} from '../helpers/charlieHarness.js'

const sendRaw = async (ws, text) => {
  ws.send(text)

  const msg = await waitFor(async () => {
    return ws.__msgs.find((m) => m?.ok === false && m?.error?.code) ?? null
  }, 1500)

  return msg
}

describe('WS contract (daemon, virt)', function () {
  this.timeout(25000)

  let child
  let port

  before(async function () {
    port = await getFreePort()

    child = startCharlieDaemon({
      port,
      mode: 'virt',
      logLevel: 'info',
    })

    await waitForWsReady({ port, timeoutMs: 12000 })
  })

  after(async function () {
    await stopCharlie(child)
  })

  it('daemon stays alive', async function () {
    assert.doesNotThrow(() => assertDaemonAlive(child))
  })

  it('state.get returns snapshot object', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'state.get')

    assert.equal(res.ok, true)
    assert.equal(res.type, 'state.get')
    assert.equal(typeof res.payload, 'object')

    // recommended: injectEnabled present (if you merged control snapshot)
    if (Object.prototype.hasOwnProperty.call(res.payload, 'injectEnabled')) {
      assert.equal(typeof res.payload.injectEnabled, 'boolean')
    }

    ws.close()
  })

  it('config.get returns config object', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'config.get')

    assert.equal(res.ok, true)
    assert.equal(res.type, 'config.get')
    assert.equal(typeof res.payload, 'object')

    ws.close()
  })

  it('inject.event is blocked when inject is disabled', async function () {
    const ws = await connectWs({ port })

    await wsRequest(ws, 'inject.disable')

    const res = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    assert.equal(res.ok, false)
    assert.equal(res.type, 'inject.event')
    assert.equal(res.error.code, 'INJECT_DISABLED')

    ws.close()
  })

  it('inject.enable allows inject.event', async function () {
    const ws = await connectWs({ port })

    const en = await wsRequest(ws, 'inject.enable')
    assert.equal(en.ok, true)
    assert.equal(en.type, 'inject.enable')

    const ev = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    assert.equal(ev.ok, true)
    assert.equal(ev.type, 'inject.event')

    ws.close()
  })

  it('inject.disable turns injection off again', async function () {
    const ws = await connectWs({ port })

    const dis = await wsRequest(ws, 'inject.disable')
    assert.equal(dis.ok, true)
    assert.equal(dis.type, 'inject.disable')

    const ev = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    assert.equal(ev.ok, false)
    assert.equal(ev.error.code, 'INJECT_DISABLED')

    ws.close()
  })

  it('driver.list returns driver entries', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'driver.list')

    assert.equal(res.ok, true)
    assert.equal(res.type, 'driver.list')
    assert.ok(res.payload)
    assert.ok(Array.isArray(res.payload.drivers))

    // If config has 0 sensors enabled, this can be empty. If non-empty, validate shape.
    if (res.payload.drivers.length > 0) {
      const d = res.payload.drivers[0]
      assert.ok(typeof d.id === 'string')
      assert.ok(typeof d.role === 'string' || d.role === null)
      assert.ok(typeof d.type === 'string' || d.type === null)
      assert.ok(typeof d.bus === 'string' || d.bus === null)
      assert.ok(typeof d.enabled === 'boolean' || d.enabled === null)
      assert.ok(typeof d.started === 'boolean' || d.started === null)
    }

    ws.close()
  })

  it('driver.disable/enable return ok for known sensorId (if present)', async function () {
    const ws = await connectWs({ port })

    const list = await wsRequest(ws, 'driver.list')
    assert.equal(list.ok, true)

    const first = (list.payload.drivers ?? [])[0]
    if (!first?.id) {
      ws.close()
      return
    }

    const dis = await wsRequest(ws, 'driver.disable', { sensorId: first.id })
    assert.equal(dis.ok, true)
    assert.equal(dis.type, 'driver.disable')

    const en = await wsRequest(ws, 'driver.enable', { sensorId: first.id })
    assert.equal(en.ok, true)
    assert.equal(en.type, 'driver.enable')

    ws.close()
  })

  it('bus.tap.start streams bus.event and bus.tap.stop stops it', async function () {
    const ws = await connectWs({ port })

    const tap = await wsRequest(ws, 'bus.tap.start', { bus: 'main' })
    assert.equal(tap.ok, true)
    assert.ok(tap.payload.subId)

    await wsRequest(ws, 'inject.enable')

    await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    const evt = await waitFor(async () => {
      return ws.__msgs.find((m) => m?.type === 'bus.event' && m?.payload?.event?.type === 'presence:enter') ?? null
    }, 3000)

    assert.equal(evt.payload.bus, 'main')
    assert.equal(evt.payload.subId, tap.payload.subId)

    const stop = await wsRequest(ws, 'bus.tap.stop', { subId: tap.payload.subId })
    assert.equal(stop.ok, true)
    assert.equal(stop.type, 'bus.tap.stop')

    // After stop, inject again and ensure no NEW bus.event arrives for that type within a short window
    const beforeCount = ws.__msgs.filter((m) => m?.type === 'bus.event').length

    await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    await waitFor(async () => true, 250) // brief delay

    const afterCount = ws.__msgs.filter((m) => m?.type === 'bus.event').length
    assert.equal(afterCount, beforeCount)

    ws.close()
  })

  it('unknown type returns UNKNOWN_TYPE', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'nope.this.does.not.exist')

    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'UNKNOWN_TYPE')

    ws.close()
  })

  it('invalid JSON returns BAD_JSON (no id)', async function () {
    const ws = await connectWs({ port })

    const msg = await sendRaw(ws, '{ this is not json')

    assert.equal(msg.ok, false)
    assert.equal(msg.error.code, 'BAD_JSON')

    ws.close()
  })
})
