// test/webserver.static.index.test.js
import assert from 'node:assert'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import WebServer from '../../src/transport/webServer.js'

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe('WebServer static: directory index + trailing slash', function () {
  this.timeout(10_000)

  let server
  let port

  let publicRoot
  let baseDirAbs
  let testDirAbs

  const baseUrl = '/__tests__/static'
  const testUrl = `${baseUrl}/test`

  before(async () => {
    const webServerFile = fileURLToPath(new URL('../src/transport/webServer.js', import.meta.url))
    const webServerDir = path.dirname(webServerFile)
    publicRoot = path.resolve(webServerDir, '../../../public')

    baseDirAbs = path.join(publicRoot, '__tests__', 'static')
    testDirAbs = path.join(baseDirAbs, 'test')

    await fs.mkdir(testDirAbs, { recursive: true })

    await fs.writeFile(
      path.join(testDirAbs, 'index.html'),
      '<!doctype html><title>static-index-fixture</title>\n',
      'utf8'
    )

    port = 18_000 + Math.floor(Math.random() * 1_000)

    server = new WebServer({
      logger: { notice() {}, error() {} },
      buses: { tasker: { publish() {} } },
      busStream: null,
      rpcRouter: { handle: async () => null },
      port,
    })

    server.start()
    await wait(50)
  })

  after(async () => {
    try {
      server?.dispose()
    } catch (e) {
      // ignore
    }

    // Cleanup only what we created; keep parent dirs if you want to add more tests later
    try {
      await fs.rm(testDirAbs, { recursive: true, force: true })
    } catch (e) {
      // ignore
    }
  })

  it('redirects /test to /test/', async () => {
    const res = await httpGet(port, testUrl)

    assert.equal(res.status, 301)
    assert.equal(res.headers.location, `${testUrl}/`)
  })

  it('serves index.html for /test/', async () => {
    const res = await httpGet(port, `${testUrl}/`)

    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] || '', /text\/html/)
    assert.match(res.body, /static-index-fixture/)
  })

  it('serves the same index via /test/index.html', async () => {
    const res = await httpGet(port, `${testUrl}/index.html`)

    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'] || '', /text\/html/)
    assert.match(res.body, /static-index-fixture/)
  })
})
