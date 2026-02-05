// test/webserver.static.index.test.js
import assert from 'node:assert'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  assertDaemonAlive,
  getFreePort,
  startCharlieDaemon,
  stopCharlie,
  waitForHttpReady,
} from '../helpers/charlieHarness.js'

const httpGet = (port, reqPath) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
        })
      })
    })

    req.on('error', reject)
  })

describe('WebServer static: directory index + trailing slash', function () {
  this.timeout(25_000)

  let child
  let port

  let publicRoot
  let testDirAbs

  const baseUrl = '/dev/__tests__/static'
  const testUrl = `${baseUrl}/static-index-fixture`

  before(async () => {
    const webServerFile = fileURLToPath(new URL('../src/transport/webServer.js', import.meta.url))
    const webServerDir = path.dirname(webServerFile)

    publicRoot = path.resolve(webServerDir, '../../../public')

    testDirAbs = path.join(publicRoot, 'dev', '__tests__', 'static', 'static-index-fixture')

    await fs.mkdir(testDirAbs, { recursive: true })

    await fs.writeFile(
      path.join(testDirAbs, 'index.html'),
      '<!doctype html><title>static-index-fixture</title>\n',
      'utf8'
    )

    port = await getFreePort()

    child = startCharlieDaemon({
      port,
      mode: 'virt',
      logLevel: 'info',
    })

    await waitForHttpReady({ port, timeoutMs: 12_000 })
  })

  after(async () => {
    try {
      await stopCharlie(child)
    } catch (e) {
      // ignore
    }

    try {
      await fs.rm(testDirAbs, { recursive: true, force: true })
    } catch (e) {
      // ignore
    }
  })

  it('daemon stays alive', async function () {
    assert.doesNotThrow(() => assertDaemonAlive(child))
  })

  it('redirects /static-index-fixture to /static-index-fixture/', async () => {
    const res = await httpGet(port, testUrl)

    assert.equal(res.status, 301)
    assert.equal(res.headers.location, `${testUrl}/`)
  })

  it('serves index.html for /static-index-fixture/', async () => {
    const res = await httpGet(port, `${testUrl}/`)

    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] || '', /text\/html/)
    assert.match(res.body, /static-index-fixture/)
  })

  it('serves the same index via /static-index-fixture/index.html', async () => {
    const res = await httpGet(port, `${testUrl}/index.html`)

    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] || '', /text\/html/)
    assert.match(res.body, /static-index-fixture/)
  })
})
