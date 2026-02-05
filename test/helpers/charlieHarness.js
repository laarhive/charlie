// test/helpers/charlieHarness.js
/**
 * Charlie integration test harness.
 *
 * Provides reusable helpers for *process-level* integration tests that
 * exercise the full Charlie application exactly as it runs in production.
 *
 * Core idea:
 * - Spawn the real `appRunner` in a separate Node.js process
 * - Communicate only via public interfaces (WebSocket / HTTP)
 * - Treat Charlie as a black box
 *
 * What this harness abstracts:
 * - Selecting a free TCP port
 * - Spawning and stopping the Charlie daemon
 * - Waiting for readiness
 * - Connecting to WS streaming endpoint (`/ws?...`)
 * - Capturing stdout/stderr for crash diagnostics
 *
 * Why this exists:
 * - Native components (uWebSockets.js) are unsafe to run in-process on Windows
 * - Process isolation ensures:
 *   - Native crashes do not kill the test runner
 *   - Startup/shutdown behavior matches real deployments
 *
 * Design rules:
 * - Never import internal Charlie modules here
 * - Never mock buses, devices, or controllers
 * - All assertions belong in spec files, not in this harness
 *
 * Intended usage:
 * - WS streaming integration tests
 * - Future Web UI integration tests
 * - End-to-end daemon interaction tests
 *
 * Non-goals:
 * - Unit testing
 * - Performance benchmarking
 * - Hardware-level validation
 *
 * If a test using this harness fails, it indicates a real runtime regression.
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import http from 'node:http'
import WebSocket from 'ws'

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export const waitFor = async (fn, timeoutMs = 8000, stepMs = 50) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const v = await fn()
    if (v) {
      return v
    }

    await wait(stepMs)
  }

  throw new Error('timeout')
}

export const getFreePort = async () => {
  const srv = net.createServer()
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  await new Promise((resolve) => srv.close(resolve))
  return port
}

export const startCharlieDaemon = ({ port, mode = 'virt', logLevel = 'info', extraArgs = [] }) => {
  const node = process.execPath
  const entry = path.join(process.cwd(), 'src', 'app', 'appRunner.js')

  const args = [
    entry,
    '--mode', mode,
    '--log-level', logLevel,
    '--port', String(port),
    ...extraArgs,
  ]

  const child = spawn(node, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  child.__out = ''
  child.__err = ''

  child.stdout.on('data', (d) => { child.__out += d.toString() })
  child.stderr.on('data', (d) => { child.__err += d.toString() })

  return child
}

export const stopCharlie = async (child, timeoutMs = 2000) => {
  if (!child || child.killed) {
    return
  }

  child.kill()

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    wait(timeoutMs),
  ])

  if (!child.killed) {
    child.kill('SIGKILL')
  }
}

/**
 * Connect to the Charlie WS endpoint.
 *
 * Notes:
 * - `/ws?…` is stream mode (supported)
 * - `/ws` is RPC mode (intentionally rejected by the server)
 *
 * @param {object} args
 * @param {number} args.port
 * @param {string} [args.path='/ws?main'] Endpoint path
 *
 * @example
 * const stream = await connectWs({ port, path: '/ws?main' })
 */
export const connectWs = async ({ port, path: p = '/ws?main' }) => {
  const pathStr = String(p || '/ws?main')
  const ws = new WebSocket(`ws://127.0.0.1:${port}${pathStr}`)
  ws.__msgs = []

  ws.on('message', (raw) => {
    try {
      ws.__msgs.push(JSON.parse(raw.toString()))
    } catch (e) {
      // ignore
    }
  })

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  // Critical: wait until server has finished attaching the stream client
  // (server sends ws:welcome after attach).
  await waitFor(async () => {
    return ws.__msgs.find((m) => m?.type === 'ws:welcome') ?? null
  }, 3000)

  return ws
}

/**
 * Wait until the streaming endpoint accepts connections.
 */
export const waitForWsReady = async ({ port, timeoutMs = 12000 }) => {
  await waitFor(async () => {
    try {
      const stream = await connectWs({ port, path: '/ws?main' })
      stream.close()
      return true
    } catch {
      return false
    }
  }, timeoutMs)

  return true
}

/**
 * Optional helper: wait until HTTP is ready.
 */
export const waitForHttpReady = async ({ port, timeoutMs = 12000 }) => {
  await waitFor(async () => {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          path: '/api/v1/status',
          method: 'GET',
        }, (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode && res.statusCode < 500))
        })

        req.on('error', () => resolve(false))
        req.end()
      })

      return Boolean(ok)
    } catch {
      return false
    }
  }, timeoutMs)

  return true
}

/**
 * Optional helper: POST JSON to an HTTP endpoint.
 */
export const httpPostJson = async ({ port, path: p, body }) => {
  const payload = JSON.stringify(body ?? {})

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: p,
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      }
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d.toString('utf8') })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ ok: false, status: res.statusCode, raw: data })
        }
      })
    })

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * Legacy helper: WebSocket RPC request/response.
 *
 * IMPORTANT:
 * - The `/ws` RPC mode is currently **disabled by design**
 * - The server closes RPC connections immediately
 * - This helper is intentionally unused today
 *
 * Why it still exists:
 * - Documents the intended future RPC contract
 * - Allows easy resurrection when RPC is implemented
 * - Prevents re-designing the test harness later
 *
 * Do NOT use this in current tests.
 */
export const wsRequest = async (ws, type, payload = {}, timeoutMs = 2000) => {
  const id = `${Date.now()}:${Math.random().toString(16).slice(2)}`
  ws.send(JSON.stringify({ id, type, payload }))

  const res = await waitFor(async () => {
    return ws.__msgs.find((m) => m?.id === id) ?? null
  }, timeoutMs)

  return res
}

export const assertDaemonAlive = (child) => {
  if (child.exitCode !== null) {
    throw new Error(
      `daemon exited early: code=${child.exitCode}\nstdout:\n${child.__out}\nstderr:\n${child.__err}`
    )
  }
}
