/**
 * Tap stream integration tests (process-level).
 *
 * Purpose:
 * - Validate that bus taps stream meaningful bus.event messages reliably
 * - Validate per-bus subscriptions (main vs presence vs vibration, etc.)
 * - Validate stop behavior (no new messages for that subId)
 *
 * Why separate from wsContract:
 * - wsContract asserts the RPC surface exists
 * - this suite asserts the streaming behavior is stable and useful for clients
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

const countBusEvents = function countBusEvents(ws, { subId = null, bus = null } = {}) {
  return ws.__msgs.filter((m) => {
    if (m?.type !== 'bus.event') {
      return false
    }

    if (subId && m?.payload?.subId !== subId) {
      return false
    }

    if (bus && m?.payload?.bus !== bus) {
      return false
    }

    return true
  }).length
}

describe('Tap stream integration (daemon, virt)', function () {
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

  it('streams multiple events on a single tap (main)', async function () {
    const ws = await connectWs({ port })

    const tap = await wsRequest(ws, 'bus.tap.start', { bus: 'main' })
    assert.equal(tap.ok, true)
    assert.ok(tap.payload?.subId)

    const subId = tap.payload.subId

    const en = await wsRequest(ws, 'inject.enable')
    assert.equal(en.ok, true)

    const inject1 = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })
    assert.equal(inject1.ok, true)

    const evt1 = await waitForBusEvent(ws, (m) => {
      return m?.payload?.subId === subId && m?.payload?.event?.type === 'presence:enter'
    })

    assert.equal(evt1.payload.bus, 'main')
    assert.equal(evt1.payload.subId, subId)
    assert.equal(evt1.payload.event.type, 'presence:enter')
    assert.equal(typeof evt1.payload.event.ts, 'number')

    const inject2 = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:exit',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })
    assert.equal(inject2.ok, true)

    const evt2 = await waitForBusEvent(ws, (m) => {
      return m?.payload?.subId === subId && m?.payload?.event?.type === 'presence:exit'
    })

    assert.equal(evt2.payload.bus, 'main')
    assert.equal(evt2.payload.subId, subId)
    assert.equal(evt2.payload.event.type, 'presence:exit')

    const stop = await wsRequest(ws, 'bus.tap.stop', { subId })
    assert.equal(stop.ok, true)

    ws.close()
  })

  it('supports independent taps per bus (main vs presence)', async function () {
    const ws = await connectWs({ port })

    const mainTap = await wsRequest(ws, 'bus.tap.start', { bus: 'main' })
    assert.equal(mainTap.ok, true)
    assert.ok(mainTap.payload?.subId)

    const presenceTap = await wsRequest(ws, 'bus.tap.start', { bus: 'presence' })
    assert.equal(presenceTap.ok, true)
    assert.ok(presenceTap.payload?.subId)

    const mainSubId = mainTap.payload.subId
    const presenceSubId = presenceTap.payload.subId

    const en = await wsRequest(ws, 'inject.enable')
    assert.equal(en.ok, true)

    // Inject directly into presence bus to verify that bus tap works independently
    const injectPresence = await wsRequest(ws, 'inject.event', {
      bus: 'presence',
      type: 'presence:raw',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front', raw: true },
    })
    assert.equal(injectPresence.ok, true)

    const pEvt = await waitForBusEvent(ws, (m) => {
      return m?.payload?.subId === presenceSubId && m?.payload?.event?.type === 'presence:raw'
    })

    assert.equal(pEvt.payload.bus, 'presence')
    assert.equal(pEvt.payload.subId, presenceSubId)
    assert.equal(pEvt.payload.event.type, 'presence:raw')

    // Ensure that presence-bus injection did NOT accidentally appear under the main tap subId
    const mainGotPresenceRaw = ws.__msgs.some((m) => {
      return m?.type === 'bus.event' &&
        m?.payload?.subId === mainSubId &&
        m?.payload?.event?.type === 'presence:raw'
    })

    assert.equal(mainGotPresenceRaw, false)

    await wsRequest(ws, 'bus.tap.stop', { subId: mainSubId })
    await wsRequest(ws, 'bus.tap.stop', { subId: presenceSubId })

    ws.close()
  })

  it('bus.tap.stop stops NEW events for that subscription', async function () {
    const ws = await connectWs({ port })

    const tap = await wsRequest(ws, 'bus.tap.start', { bus: 'main' })
    assert.equal(tap.ok, true)
    assert.ok(tap.payload?.subId)

    const subId = tap.payload.subId

    const en = await wsRequest(ws, 'inject.enable')
    assert.equal(en.ok, true)

    await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })

    await waitForBusEvent(ws, (m) => {
      return m?.payload?.subId === subId && m?.payload?.event?.type === 'presence:enter'
    })

    const stop = await wsRequest(ws, 'bus.tap.stop', { subId })
    assert.equal(stop.ok, true)

    const before = countBusEvents(ws, { subId })

    await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' },
    })

    // small delay to allow any incorrect streaming to arrive
    await waitFor(async () => true, 250)

    const after = countBusEvents(ws, { subId })
    assert.equal(after, before)

    ws.close()
  })
})
