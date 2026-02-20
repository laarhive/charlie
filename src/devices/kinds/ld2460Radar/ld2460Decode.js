// src/devices/kinds/ld2460Radar/ld2460Decode.js
import { EventEmitter } from 'node:events'

const REPORT_HEADER = Buffer.from([0xf4, 0xf3, 0xf2, 0xf1])
const REPORT_TAIL = Buffer.from([0xf8, 0xf7, 0xf6, 0xf5])

const FUNC_CODE_TRACKING = 0x04
const FIXED_OVERHEAD_BYTES = 11 // header(4) + func(1) + len(2) + tail(4)
const TARGET_STRIDE = 4 // X(2) + Y(2)
const POS_UNIT_MM = 100 // "accuracy 0.1" => 0.1m = 100mm

const decodePosMm = function decodePosMm(u16) {
  // Use signed int16 semantics for coordinates (typical for centered coordinate frames)
  // Convert uint16 to int16 range
  const v = (u16 & 0x8000) !== 0 ? u16 - 0x10000 : u16
  return v * POS_UNIT_MM
}

const isValidByRule = function isValidByRule(t, rule) {
  if (rule === 'resolution') return t.resolutionMm !== 0
  if (rule === 'nonzeroXY') return t.xMm !== 0 || t.yMm !== 0
  if (rule === 'either') return t.resolutionMm !== 0 || t.xMm !== 0 || t.yMm !== 0
  return t.xMm !== 0 || t.yMm !== 0
}

export const decodeLd2460TrackingFrames = function decodeLd2460TrackingFrames(buf, opts = {}) {
  const maxFrames = Number.isFinite(opts.maxFrames) ? opts.maxFrames : Infinity
  const validRule = typeof opts.validRule === 'string' ? opts.validRule : 'nonzeroXY'

  const frames = []
  const stats = {
    scannedBytes: buf.length,
    foundHeaders: 0,
    decodedFrames: 0,
    badFooters: 0,
    badLengths: 0,
    badFunc: 0,
  }

  let droppedBytes = 0
  let i = 0

  while (i <= buf.  length - REPORT_HEADER.length && frames.length < maxFrames) {
    const headerIdx = buf.indexOf(REPORT_HEADER, i)

    if (headerIdx === -1) {
      const keep = Math.min(buf.length, REPORT_HEADER.length - 1)
      const remainder = keep > 0 ? buf.subarray(buf.length - keep) : Buffer.alloc(0)

      droppedBytes = buf.length - remainder.length

      return { frames, remainder, droppedBytes, stats }
    }

    stats.foundHeaders += 1

    // Need at least header(4) + func(1) + len(2) before we can know full packet length
    if (headerIdx + 7 > buf.length) {
      const remainder = buf.subarray(headerIdx)

      droppedBytes = frames.length === 0 ? headerIdx : droppedBytes

      return { frames, remainder, droppedBytes, stats }
    }

    const func = buf[headerIdx + 4]
    if (func !== FUNC_CODE_TRACKING) {
      stats.badFunc += 1
      i = headerIdx + 1
      continue
    }

    const packetLen = buf.readUInt16LE(headerIdx + 5)

    // Must be at least overhead and align with target stride
    if (packetLen < FIXED_OVERHEAD_BYTES || ((packetLen - FIXED_OVERHEAD_BYTES) % TARGET_STRIDE) !== 0) {
      stats.badLengths += 1
      i = headerIdx + 1
      continue
    }

    if (headerIdx + packetLen > buf.length) {
      const remainder = buf.subarray(headerIdx)

      droppedBytes = frames.length === 0 ? headerIdx : droppedBytes

      return { frames, remainder, droppedBytes, stats }
    }

    const tailIdx = headerIdx + packetLen - REPORT_TAIL.length
    if (
      buf[tailIdx + 0] !== REPORT_TAIL[0] ||
      buf[tailIdx + 1] !== REPORT_TAIL[1] ||
      buf[tailIdx + 2] !== REPORT_TAIL[2] ||
      buf[tailIdx + 3] !== REPORT_TAIL[3]
    ) {
      stats.badFooters += 1
      i = headerIdx + 1
      continue
    }

    const targetsCount = (packetLen - FIXED_OVERHEAD_BYTES) / TARGET_STRIDE
    const targets = []

    for (let t = 0; t < targetsCount; t += 1) {
      const base = headerIdx + 7 + t * TARGET_STRIDE

      const xRaw = buf.readUInt16LE(base + 0)
      const yRaw = buf.readUInt16LE(base + 2)

      const target = {
        id: t + 1,
        xMm: decodePosMm(xRaw),
        yMm: decodePosMm(yRaw),

        // LD2460 report frame (per provided table) only carries X/Y.
        // Keep shape aligned with LD2450 targets.
        speedCms: 0,
        resolutionMm: 0,
      }

      target.valid = isValidByRule(target, validRule)

      targets.push(target)
    }

    const present = targets.some((t) => t.valid)

    if (frames.length === 0) {
      droppedBytes = headerIdx
    }

    frames.push({
      targets,
      present,
    })

    stats.decodedFrames += 1
    i = headerIdx + packetLen
  }

  const remainder = i < buf.length ? buf.subarray(i) : Buffer.alloc(0)

  return { frames, remainder, droppedBytes, stats }
}

export const createLd2460StreamDecoder = function createLd2460StreamDecoder(opts = {}) {
  const emitter = new EventEmitter()

  let carry = Buffer.alloc(0)
  let totalFrames = 0
  let totalBadFooters = 0
  let totalBadLengths = 0
  let totalBadFunc = 0
  let totalDropped = 0

  const validRule = typeof opts.validRule === 'string' ? opts.validRule : 'nonzeroXY'
  const maxFramesPerPush = Number.isFinite(opts.maxFramesPerPush) ? opts.maxFramesPerPush : Infinity
  const maxBufferBytes = Number.isFinite(opts.maxBufferBytes) ? opts.maxBufferBytes : 4096
  const noiseLogThreshold = Number.isFinite(opts.noiseLogThreshold) ? opts.noiseLogThreshold : 32
  const nowMs = typeof opts.nowMs === 'function' ? opts.nowMs : () => Date.now()

  const reset = function reset() {
    carry = Buffer.alloc(0)
  }

  const getState = function getState() {
    return {
      carryBytes: carry.length,
      totalFrames,
      totalBadFooters,
      totalBadLengths,
      totalBadFunc,
      totalDropped,
    }
  }

  const push = function push(chunk) {
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

    if (carry.length < 7) {
      return
    }

    const res = decodeLd2460TrackingFrames(carry, {
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

    if (res.stats.badLengths > 0) {
      totalBadLengths += res.stats.badLengths
      emitter.emit('error', { code: 'BAD_LENGTH', count: res.stats.badLengths })
    }

    if (res.stats.badFunc > 0) {
      totalBadFunc += res.stats.badFunc
      emitter.emit('error', { code: 'BAD_FUNC', count: res.stats.badFunc })
    }

    const batchTs = nowMs()

    for (const frame of res.frames) {
      totalFrames += 1
      emitter.emit('frame', {
        ts: batchTs,
        ...frame,
      })
    }

    if (opts.emitStats === true) {
      emitter.emit('stats', {
        ts: nowMs(),
        decodedFrames: res.stats.decodedFrames,
        foundHeaders: res.stats.foundHeaders,
        badFooters: res.stats.badFooters,
        badLengths: res.stats.badLengths,
        badFunc: res.stats.badFunc,
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
