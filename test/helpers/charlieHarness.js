/**
 * Charlie integration test harness.
 *
 * This module provides reusable helpers for process-level integration tests
 * that exercise the full Charlie application exactly as it runs in production.
 *
 * Core idea:
 * - Spawn the real `appRunner` in a separate Node.js process
 * - Communicate only via public interfaces (WebSocket / HTTP)
 * - Treat Charlie as a black box
 *
 * What this harness abstracts:
 * - Selecting a free TCP port
 * - Spawning and stopping the Charlie daemon
 * - Waiting for WebSocket readiness
 * - Sending WS RPC requests and awaiting responses
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
 * - Never mock buses, drivers, or controllers
 * - All assertions belong in spec files, not in this harness
 *
 * Intended usage:
 * - WS API contract tests
 * - Future Web UI integration tests
 * - End-to-end CLI / daemon interaction tests
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
    '--cmd', 'daemon',
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

export const connectWs = async ({ port }) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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

  return ws
}

export const waitForWsReady = async ({ port, timeoutMs = 12000 }) => {
  await waitFor(async () => {
    try {
      const ws = await connectWs({ port })
      ws.close()
      return true
    } catch (e) {
      return false
    }
  }, timeoutMs)

  return true
}

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
