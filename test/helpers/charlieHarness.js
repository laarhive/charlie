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
