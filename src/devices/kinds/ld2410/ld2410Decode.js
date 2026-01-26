// src/devices/kinds/ld2410Radar/ld2410Decode.js
import { EventEmitter } from 'node:events'

const REPORT_HEADER = Buffer.from([0xF4, 0xF3, 0xF2, 0xF1])
const REPORT_TAIL = Buffer.from([0xF8, 0xF7, 0xF6, 0xF5])

const INNER_HEAD = 0xAA
const INNER_TAIL = 0x55
const INNER_CHECK = 0x00

const TYPE_ENGINEERING = 0x01
const TYPE_BASIC = 0x02

const BASIC_PAYLOAD_LEN = 0x0D
const ENGINEERING_PAYLOAD_LEN = 0x23

const decodeTargetState = function (v) {
  if (v === 0x00) return 'none'
  if (v === 0x01) return 'moving'
  if (v === 0x02) return 'stationary'
  if (v === 0x03) return 'moving+stationary'
  return 'unknown'
}

const isPresentByState = function (stateVal) {
  return stateVal !== 0x00
}

export const decodeLd2410ReportFrames = function (buf, opts = {}) {
  const maxFrames = Number.isFinite(opts.maxFrames) ? opts.maxFrames : Infinity
  const includeRaw = opts.includeRaw === true

  const frames = []
  const stats = {
    scannedBytes: buf.length,
    foundHeaders: 0,
    decodedFrames: 0,
    badFooters: 0,
    badLengths: 0,
    badInner: 0,
  }

  let droppedBytes = 0
  let i = 0
  let remainder = Buffer.alloc(0)

  const minOuterLen = 4 + 2 + 2 + 4

  while (i <= buf.length - minOuterLen && frames.length < maxFrames) {
    const headerIdx = buf.indexOf(REPORT_HEADER, i)

    if (headerIdx === -1) {
      droppedBytes = buf.length
      return { frames, remainder: Buffer.alloc(0), droppedBytes, stats }
    }

    stats.foundHeaders += 1

    if (headerIdx + minOuterLen > buf.length) {
      droppedBytes = headerIdx
      remainder = buf.subarray(headerIdx)
      return { frames, remainder, droppedBytes, stats }
    }

    const len = buf.readUInt16LE(headerIdx + 4)
    const outerLen = 4 + 2 + len + 4

    if (headerIdx + outerLen > buf.length) {
      droppedBytes = headerIdx
      remainder = buf.subarray(headerIdx)
      return { frames, remainder, droppedBytes, stats }
    }

    const tailOff = headerIdx + 4 + 2 + len
    const isTailOk =
      buf[tailOff + 0] === REPORT_TAIL[0] &&
      buf[tailOff + 1] === REPORT_TAIL[1] &&
      buf[tailOff + 2] === REPORT_TAIL[2] &&
      buf[tailOff + 3] === REPORT_TAIL[3]

    if (!isTailOk) {
      stats.badFooters += 1
      i = headerIdx + 1
      continue
    }

    const payloadOff = headerIdx + 6
    const payload = buf.subarray(payloadOff, payloadOff + len)

    const type = payload[0]
    const head = payload[1]

    if (head !== INNER_HEAD) {
      stats.badInner += 1
      i = headerIdx + 1
      continue
    }

    if (len !== BASIC_PAYLOAD_LEN && len !== ENGINEERING_PAYLOAD_LEN) {
      stats.badLengths += 1
      i = headerIdx + 1
      continue
    }

    const tail = payload[len - 2]
    const check = payload[len - 1]

    if (tail !== INNER_TAIL || check !== INNER_CHECK) {
      stats.badInner += 1
      i = headerIdx + 1
      continue
    }

    const stateVal = payload[2]

    const movingDistCm = payload.readUInt16LE(3)
    const movingEnergy = payload[5]
    const stationaryDistCm = payload.readUInt16LE(6)
    const stationaryEnergy = payload[8]
    const detectionDistCm = payload.readUInt16LE(9)

    const frame = {
      offset: headerIdx,
      raw: includeRaw ? Buffer.from(buf.subarray(headerIdx, headerIdx + outerLen)) : undefined,
      type: type === TYPE_ENGINEERING ? 'engineering' : (type === TYPE_BASIC ? 'basic' : 'unknown'),
      target: {
        state: decodeTargetState(stateVal),
        stateVal,
        movingDistCm,
        movingEnergy,
        stationaryDistCm,
        stationaryEnergy,
        detectionDistCm,
      },
      present: isPresentByState(stateVal),
    }

    if (type === TYPE_ENGINEERING && len === ENGINEERING_PAYLOAD_LEN) {
      const maxMovingGate = payload[11]
      const maxStaticGate = payload[12]

      const movingCount = Math.max(0, maxMovingGate + 1)
      const staticCount = Math.max(0, maxStaticGate + 1)

      const movingStart = 13
      const staticStart = movingStart + movingCount

      const staticEnd = staticStart + staticCount
      const lightOff = staticEnd
      const outPinOff = staticEnd + 1

      const safe = outPinOff < (len - 2)

      if (safe) {
        const movingEnergies = []
        for (let k = 0; k < movingCount; k += 1) movingEnergies.push(payload[movingStart + k])

        const staticEnergies = []
        for (let k = 0; k < staticCount; k += 1) staticEnergies.push(payload[staticStart + k])

        frame.engineering = {
          maxMovingGate,
          maxStaticGate,
          movingEnergies,
          staticEnergies,
          light: payload[lightOff],
          outPin: payload[outPinOff],
        }
      } else {
        frame.engineering = {
          maxMovingGate,
          maxStaticGate,
          parseError: 'engineering_layout_out_of_bounds',
        }
      }
    }

    frames.push(frame)

    stats.decodedFrames += 1
    i = headerIdx + outerLen
  }

  droppedBytes = frames.length > 0 ? frames[0].offset : 0
  return { frames, remainder: Buffer.alloc(0), droppedBytes, stats }
}

export const createLd2410StreamDecoder = function (opts = {}) {
  const emitter = new EventEmitter()

  let carry = Buffer.alloc(0)
  let totalFrames = 0
  let totalBadFooters = 0
  let totalBadLengths = 0
  let totalBadInner = 0
  let totalDropped = 0

  const includeRaw = opts.includeRaw === true
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
      totalBadLengths,
      totalBadInner,
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

    if (carry.length < 10) return

    const res = decodeLd2410ReportFrames(carry, {
      maxFrames: maxFramesPerPush,
      includeRaw,
    })

    if (res.frames.length > 0) {
      totalDropped += res.droppedBytes

      if (res.droppedBytes >= noiseLogThreshold) {
        emitter.emit('error', { code: 'DROPPED_NOISE', droppedBytes: res.droppedBytes })
      }
    }

    if (res.stats.badFooters > 0) {
      totalBadFooters += res.stats.badFooters
      emitter.emit('error', { code: 'BAD_FOOTER', count: res.stats.badFooters })
    }

    if (res.stats.badLengths > 0) {
      totalBadLengths += res.stats.badLengths
      emitter.emit('error', { code: 'BAD_LENGTH', count: res.stats.badLengths })
    }

    if (res.stats.badInner > 0) {
      totalBadInner += res.stats.badInner
      emitter.emit('error', { code: 'BAD_INNER', count: res.stats.badInner })
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
        badLengths: res.stats.badLengths,
        badInner: res.stats.badInner,
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
