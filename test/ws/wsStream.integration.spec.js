/**
 * Bus streaming integration tests (process-level).
 *
 * Purpose:
 * - Validate that the `/ws` streaming endpoint emits meaningful `bus.event` messages reliably
 * - Validate per-bus selection via URL query params (e.g. `/ws?main` vs `/ws?presence`)
 * - Validate that only the selected buses are streamed to a connection
 *
 * Why separate from wsContract:
 * - wsContract validates the RPC surface on `/rpc`
 * - this suite validates streaming behavior and usefulness for clients on `/ws`
 *
 * Architecture assumptions:
 * - RPC is served on `/rpc` (used here only to trigger inject events)
 * - Streaming is served on `/ws?...` (server-push only)
 * - No legacy `bus.tap.*` RPC exists
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
  wsRequest,
} from '../helpers/charlieHarness.js'

const waitForBusEvent = async function waitForBusEvent(ws, predicate, timeoutMs = 3000) {
  const msg = await waitFor(async () => {
    return ws.__msgs.find((m) => m?.type === 'bus.event' && predicate(m)) ?? null
  }, timeoutMs)

  return msg
}

const countBusEvents = function countBusEvents(ws, { bus = null } = {}) {
  return ws.__msgs.filter((m) => {
    if (m?.type !== 'bus.event') {
      return false
    }

    if (bus && m?.payload?.bus !== bus) {
      return false
    }

    return true
  }).length
}

describe('Bus streaming integration (daemon, virt)', function () {
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

  it('streams multiple events on a single connection (main)', async function () {
    const rpc = await connectWs({ port, path: '/rpc' })
    const stream = await connectWs({ port, path: '/ws?main' })

    const en = await wsRequest(rpc, 'inject.enable')
    assert.equal(en.ok, true)

    const inject1 = await wsRequest(rpc, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })
    assert.equal(inject1.ok, true)

    const evt1 = await waitForBusEvent(stream, (m) => {
      return m?.payload?.bus === 'main' && m?.payload?.event?.type === 'presence:enter'
    })

    assert.equal(evt1.payload.bus, 'main')
    assert.equal(evt1.payload.event.type, 'presence:enter')
    assert.equal(typeof evt1.payload.event.ts, 'number')

    const inject2 = await wsRequest(rpc, 'inject.event', {
      bus: 'main',
      type: 'presence:exit',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })
    assert.equal(inject2.ok, true)

    const evt2 = await waitForBusEvent(stream, (m) => {
      return m?.payload?.bus === 'main' && m?.payload?.event?.type === 'presence:exit'
    })

    assert.equal(evt2.payload.bus, 'main')
    assert.equal(evt2.payload.event.type, 'presence:exit')

    rpc.close()
    stream.close()
  })

  it('supports independent streaming selection per connection (main vs presence)', async function () {
    const rpc = await connectWs({ port, path: '/rpc' })

    const streamMain = await connectWs({ port, path: '/ws?main' })
    const streamPresence = await connectWs({ port, path: '/ws?presence' })

    const en = await wsRequest(rpc, 'inject.enable')
    assert.equal(en.ok, true)

    // Inject directly into presence bus to verify independent selection
    const injectPresence = await wsRequest(rpc, 'inject.event', {
      bus: 'presence',
      type: 'presence:raw',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front', raw: true },
    })
    assert.equal(injectPresence.ok, true)

    const pEvt = await waitForBusEvent(streamPresence, (m) => {
      return m?.payload?.bus === 'presence' && m?.payload?.event?.type === 'presence:raw'
    })

    assert.equal(pEvt.payload.bus, 'presence')
    assert.equal(pEvt.payload.event.type, 'presence:raw')

    // Ensure it did NOT appear on the main-only stream within a short window
    await waitFor(async () => true, 250)

    const mainGotPresenceRaw = streamMain.__msgs.some((m) => {
      return m?.type === 'bus.event' &&
        m?.payload?.bus === 'main' &&
        m?.payload?.event?.type === 'presence:raw'
    })

    assert.equal(mainGotPresenceRaw, false)

    rpc.close()
    streamMain.close()
    streamPresence.close()
  })

  it('stream endpoint streams bus.event (main)', async function () {
    const rpc = await connectWs({ port, path: '/rpc' })
    const stream = await connectWs({ port, path: '/ws?main' })

    await wsRequest(rpc, 'inject.enable')

    await wsRequest(rpc, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    const evt = await waitFor(async () => {
      return stream.__msgs.find((m) => m?.type === 'bus.event' && m?.payload?.event?.type === 'presence:enter') ?? null
    }, 3000)

    assert.equal(evt.payload.bus, 'main')
    assert.equal(evt.payload.event.type, 'presence:enter')

    rpc.close()
    stream.close()
  })

  it('closing a stream connection stops NEW events for that connection', async function () {
    const rpc = await connectWs({ port, path: '/rpc' })
    const stream = await connectWs({ port, path: '/ws?main' })

    const en = await wsRequest(rpc, 'inject.enable')
    assert.equal(en.ok, true)

    await wsRequest(rpc, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })

    await waitForBusEvent(stream, (m) => {
      return m?.payload?.bus === 'main' && m?.payload?.event?.type === 'presence:enter'
    })

    const before = countBusEvents(stream, { bus: 'main' })

    stream.close()

    await wsRequest(rpc, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })

    await waitFor(async () => true, 250)

    const after = countBusEvents(stream, { bus: 'main' })
    assert.equal(after, before)

    rpc.close()
  })
})
