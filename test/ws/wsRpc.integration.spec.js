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

describe('Integration: appRunner (virt daemon) WS API', function () {
  this.timeout(20000)

  let child
  let port

  before(async function () {
    port = await getFreePort()
    child = startCharlieDaemon({ port, mode: 'virt', logLevel: 'info' })

    await waitForWsReady({ port, timeoutMs: 12000 })
  })

  after(async function () {
    await stopCharlie(child)
  })

  it('state.get responds', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'state.get')

    assert.equal(res.ok, true)
    assert.equal(res.type, 'state.get')

    ws.close()
  })

  it('config.get responds', async function () {
    const ws = await connectWs({ port })

    const res = await wsRequest(ws, 'config.get')

    assert.equal(res.ok, true)
    assert.ok(res.payload)

    ws.close()
  })

  it('inject.enable then inject.event succeeds', async function () {
    const ws = await connectWs({ port })

    const en = await wsRequest(ws, 'inject.enable')
    assert.equal(en.ok, true)

    const ev = await wsRequest(ws, 'inject.event', {
      bus: 'main',
      type: 'presence:enter',
      source: 'test',
      payload: { zone: 'front', sensorId: 'presence_front' }
    })

    assert.equal(ev.ok, true)

    ws.close()
  })

  it('daemon stays alive during tests', async function () {
    assert.doesNotThrow(() => assertDaemonAlive(child))
  })
})
