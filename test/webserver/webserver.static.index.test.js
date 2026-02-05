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

  const baseUrl = '/dev/__tests__/static'
  const testUrl = `${baseUrl}/static-index-fixture`

  before(async () => {
    const webServerFile = fileURLToPath(new URL('../../src/transport/webServer.js', import.meta.url))
    const webServerDir = path.dirname(webServerFile)

    publicRoot = path.resolve(webServerDir, '../../../public')

    baseDirAbs = path.join(publicRoot, 'dev', '__tests__', 'static')
    testDirAbs = path.join(baseDirAbs, 'static-index-fixture')

    await fs.mkdir(testDirAbs, { recursive: true })

    await fs.writeFile(
      path.join(testDirAbs, 'index.html'),
      '<!doctype html><title>static-index-fixture</title>\n',
      'utf8'
    )

    port = 18_000 + Math.floor(Math.random() * 1_000)

    server = new WebServer({
      logger: { notice() {}, error() {} },
      port,
      api: {},
      streamHub: null,
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

    try {
      await fs.rm(testDirAbs, { recursive: true, force: true })
    } catch (e) {
      // ignore
    }
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
