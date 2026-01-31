// test/ws/wsStream.integration.spec.js
/**
 * Bus streaming integration tests (process-level).
 *
 * Validates that the `/ws` endpoint emits `bus.event` messages and supports
 * per-bus selection via query params.
 *
 * This suite uses a test-only HTTP hook (enabled with CHARLIE_TEST=1) to
 * publish deterministic events to buses:
 *   POST /__tests__/publish
 */

import assert from 'node:assert/strict'

import {
  assertDaemonAlive,
  connectWs,
  getFreePort,
  httpPostJson,
  startCharlieDaemon,
  stopCharlie,
  waitFor,
  waitForHttpReady,
} from '../helpers/charlieHarness.js'

const waitForBusEvent = async function waitForBusEvent(ws, predicate, timeoutMs = 3000) {
  const msg = await waitFor(async () => {
    return ws.__msgs.find((m) => m?.type === 'bus.event' && predicate(m)) ?? null
  }, timeoutMs)

  return msg
}

describe('Bus streaming integration (daemon, virt)', function () {
  this.timeout(25000)

  let child
  let port
  let prevTestEnv

  before(async function () {
    prevTestEnv = process.env.CHARLIE_TEST
    process.env.CHARLIE_TEST = '1'

    port = await getFreePort()

    child = startCharlieDaemon({
      port,
      mode: 'virt',
      logLevel: 'info',
    })

    await waitForHttpReady({ port, timeoutMs: 12000 })
  })

  after(async function () {
    await stopCharlie(child)

    if (prevTestEnv === undefined) {
      delete process.env.CHARLIE_TEST
    } else {
      process.env.CHARLIE_TEST = prevTestEnv
    }
  })

  it('daemon stays alive', async function () {
    assert.doesNotThrow(() => assertDaemonAlive(child))
  })

  it('streams events for selected bus (main)', async function () {
    const stream = await connectWs({ port, path: '/ws?main' })

    const published = await httpPostJson({
      port,
      path: '/__tests__/publish',
      body: {
        bus: 'main',
        event: {
          type: 'test:ping',
          ts: Date.now(),
          source: 'wsStreamTest',
          payload: { n: 1 },
        }
      }
    })

    assert.equal(published.ok, true)

    const evt = await waitForBusEvent(stream, (m) => {
      return m?.payload?.bus === 'main' && m?.payload?.event?.type === 'test:ping'
    })

    assert.equal(evt.payload.bus, 'main')
    assert.equal(evt.payload.event.type, 'test:ping')

    stream.close()
  })

  it('does not stream events from non-selected bus', async function () {
    const streamMain = await connectWs({ port, path: '/ws?main' })

    const published = await httpPostJson({
      port,
      path: '/__tests__/publish',
      body: {
        bus: 'presence',
        event: {
          type: 'test:presence',
          ts: Date.now(),
          source: 'wsStreamTest',
          payload: { n: 2 },
        }
      }
    })

    assert.equal(published.ok, true)

    await waitFor(async () => true, 250)

    const got = streamMain.__msgs.some((m) => {
      return m?.type === 'bus.event' && m?.payload?.event?.type === 'test:presence'
    })

    assert.equal(got, false)

    streamMain.close()
  })

  it('supports independent selection per connection (main vs presence)', async function () {
    const streamMain = await connectWs({ port, path: '/ws?main' })
    const streamPresence = await connectWs({ port, path: '/ws?presence' })

    const published = await httpPostJson({
      port,
      path: '/__tests__/publish',
      body: {
        bus: 'presence',
        event: {
          type: 'test:presence',
          ts: Date.now(),
          source: 'wsStreamTest',
          payload: { n: 3 },
        }
      }
    })

    assert.equal(published.ok, true)

    const evt = await waitForBusEvent(streamPresence, (m) => {
      return m?.payload?.bus === 'presence' && m?.payload?.event?.type === 'test:presence'
    })

    assert.equal(evt.payload.bus, 'presence')
    assert.equal(evt.payload.event.type, 'test:presence')

    await waitFor(async () => true, 250)

    const gotOnMain = streamMain.__msgs.some((m) => {
      return m?.type === 'bus.event' && m?.payload?.event?.type === 'test:presence'
    })

    assert.equal(gotOnMain, false)

    streamMain.close()
    streamPresence.close()
  })
})
