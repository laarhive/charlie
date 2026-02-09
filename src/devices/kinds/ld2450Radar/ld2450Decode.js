// src/devices/kinds/ld2450Radar/ld2450Decode.js
import { EventEmitter } from 'node:events'

const REPORT_HEADER = Buffer.from([0xaa, 0xff, 0x03, 0x00])
const REPORT_TAIL = Buffer.from([0x55, 0xcc])
const FRAME_LEN = 30
const TARGETS = 3
const TARGET_STRIDE = 8

const decodeSigned15PosBit = function (u16) {
  if ((u16 & 0x8000) !== 0) {
    return u16 - 0x8000
  }

  return -u16
}

const isValidByRule = function (t, rule) {
  if (rule === 'resolution') return t.resolutionMm !== 0
  if (rule === 'nonzeroXY') return t.xMm !== 0 || t.yMm !== 0
  if (rule === 'either') return t.resolutionMm !== 0 || t.xMm !== 0 || t.yMm !== 0
  return t.resolutionMm !== 0
}

export const decodeLd2450TrackingFrames = function (buf, opts = {}) {
  const maxFrames = Number.isFinite(opts.maxFrames) ? opts.maxFrames : Infinity
  const validRule = typeof opts.validRule === 'string' ? opts.validRule : 'resolution'

  const frames = []
  const stats = {
    scannedBytes: buf.length,
    foundHeaders: 0,
    decodedFrames: 0,
    badFooters: 0,
  }

  let droppedBytes = 0
  let i = 0

  while (i <= buf.length - REPORT_HEADER.length && frames.length < maxFrames) {
    const headerIdx = buf.indexOf(REPORT_HEADER, i)

    if (headerIdx === -1) {
      const keep = Math.min(buf.length, REPORT_HEADER.length - 1) // keep last 3 bytes
      const remainder = keep > 0 ? buf.subarray(buf.length - keep) : Buffer.alloc(0)

      droppedBytes = buf.length - remainder.length

      return { frames, remainder, droppedBytes, stats }
    }

    stats.foundHeaders += 1

    if (headerIdx + FRAME_LEN > buf.length) {
      const remainder = buf.subarray(headerIdx)

      droppedBytes = frames.length === 0 ? headerIdx : droppedBytes

      return { frames, remainder, droppedBytes, stats }
    }

    if (buf[headerIdx + 28] !== REPORT_TAIL[0] || buf[headerIdx + 29] !== REPORT_TAIL[1]) {
      stats.badFooters += 1
      i = headerIdx + 1
      continue
    }

    const frameBuf = buf.subarray(headerIdx, headerIdx + FRAME_LEN)
    const targets = []

    for (let t = 0; t < TARGETS; t += 1) {
      const base = headerIdx + 4 + t * TARGET_STRIDE

      const xRaw = buf.readUInt16LE(base + 0)
      const yRaw = buf.readUInt16LE(base + 2)
      const sRaw = buf.readUInt16LE(base + 4)
      const rRaw = buf.readUInt16LE(base + 6)

      const target = {
        id: t + 1,
        xMm: decodeSigned15PosBit(xRaw),
        yMm: decodeSigned15PosBit(yRaw),
        speedCms: decodeSigned15PosBit(sRaw),
        resolutionMm: rRaw,
      }

      target.valid = isValidByRule(target, validRule)

      targets.push(target)
    }

    const present = targets.some((t) => t.valid)

    if (frames.length === 0) {
      droppedBytes = headerIdx
    }

    frames.push({
      // offset: headerIdx,
      targets,
      present,
    })

    stats.decodedFrames += 1
    i = headerIdx + FRAME_LEN
  }

  const remainder = i < buf.length ? buf.subarray(i) : Buffer.alloc(0)

  return { frames, remainder, droppedBytes, stats }
}

export const createLd2450StreamDecoder = function (opts = {}) {
  const emitter = new EventEmitter()

  let carry = Buffer.alloc(0)
  let totalFrames = 0
  let totalBadFooters = 0
  let totalDropped = 0

  const validRule = typeof opts.validRule === 'string' ? opts.validRule : 'resolution'
  const maxFramesPerPush = Number.isFinite(opts.maxFramesPerPush) ? opts.maxFramesPerPush : Infinity
  const maxBufferBytes = Number.isFinite(opts.maxBufferBytes) ? opts.maxBufferBytes : 4096
  const noiseLogThreshold = Number.isFinite(opts.noiseLogThreshold) ? opts.noiseLogThreshold : 32
  const nowMs = typeof opts.nowMs === 'function' ? opts.nowMs : () => Date.now()

  const reset = function () {
    carry = Buffer.alloc(0)
  }

  const getState = function () {
    return {
      carryBytes: carry.length,
      totalFrames,
      totalBadFooters,
      totalDropped,
    }
  }

  const push = function (chunk) {
    if (!Buffer.isBuffer(chunk)) {
      emitter.emit('error', { code: 'INVALID_CHUNK', message: 'push(chunk) requires a Buffer' })
      return
    }

    carry = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])

    if (carry.length > maxBufferBytes) {
      const lastHeader = carry.lastIndexOf(REPORT_HEADER)

      if (lastHeader === -1) {
        totalDropped += carry.length
        emitter.emit('error', { code: 'BUFFER_OVERFLOW_DROP_ALL', droppedBytes: carry.length })
        carry = Buffer.alloc(0)
        return
      }

      if (lastHeader > 0) {
        totalDropped += lastHeader
        emitter.emit('error', { code: 'BUFFER_OVERFLOW_DROP_PREFIX', droppedBytes: lastHeader })
        carry = carry.subarray(lastHeader)
      }
    }

    if (carry.length < FRAME_LEN) {
      return
    }

    const res = decodeLd2450TrackingFrames(carry, {
      maxFrames: maxFramesPerPush,
      validRule,
    })

    totalDropped += res.droppedBytes

    if (res.droppedBytes >= noiseLogThreshold) {
      emitter.emit('error', { code: 'DROPPED_NOISE', droppedBytes: res.droppedBytes })
    }

    if (res.stats.badFooters > 0) {
      totalBadFooters += res.stats.badFooters
      emitter.emit('error', { code: 'BAD_FOOTER', count: res.stats.badFooters })
    }

    for (const frame of res.frames) {
      totalFrames += 1
      emitter.emit('frame', {
        ts: nowMs(),
        ...frame,
      })
    }

    if (opts.emitStats === true) {
      emitter.emit('stats', {
        ts: nowMs(),
        decodedFrames: res.stats.decodedFrames,
        foundHeaders: res.stats.foundHeaders,
        badFooters: res.stats.badFooters,
        droppedBytes: res.droppedBytes,
        carryBytes: res.remainder.length,
        totals: getState(),
      })
    }

    carry = res.remainder
  }

  emitter.push = push
  emitter.reset = reset
  emitter.getState = getState

  return emitter
}
