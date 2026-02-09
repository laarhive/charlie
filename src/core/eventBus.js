// src/core/eventBus.js
import { EventEmitter } from 'node:events'

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

const assertNonEmptyString = (name, v) => {
  const s = String(v || '').trim()
  if (!s) {
    const err = new Error(`event_invalid_${name}`)
    err.code = 'EVENT_INVALID'
    err.detail = { field: name }
    console.log(err)
    throw err
  }

  return s
}

const assertFiniteNumber = (name, v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) {
    const err = new Error(`event_invalid_${name}`)
    err.code = 'EVENT_INVALID'
    err.detail = { field: name }
    console.log(err)
    throw err
  }

  return n
}

export const makeStreamKey = ({ who, what, where, why = null }) => {
  const a = assertNonEmptyString('streamKey.who', who)
  const b = assertNonEmptyString('streamKey.what', what)
  const c = assertNonEmptyString('streamKey.where', where)
  const d = why ? assertNonEmptyString('streamKey.why', why) : null

  return d ? `${a}::${b}::${d}::${c}` : `${a}::${b}::${c}`
}

export class EventBus {
  #emitter
  #busId
  #strict

  constructor({ busId, strict = true } = {}) {
    this.#emitter = new EventEmitter()
    // this.#busId = assertNonEmptyString('busId', busId)
    this.#strict = strict === true
  }

  getBusId() {
    return this.#busId
  }

  publish(event) {
    if (!isPlainObject(event)) {
      if (this.#strict) {
        const err = new Error('event_not_object')
        err.code = 'EVENT_INVALID'
        throw err
      }

      return
    }

    const bus = event.bus == null ? this.#busId : String(event.bus)
    if (bus !== this.#busId) {
      if (this.#strict) {
        const err = new Error('event_bus_mismatch')
        err.code = 'EVENT_INVALID'
        err.detail = { expected: this.#busId, got: bus }
        throw err
      }

      return
    }

    assertNonEmptyString('type', event.type)
    assertFiniteNumber('ts', event.ts)
    assertNonEmptyString('source', event.source)
    assertNonEmptyString('streamKey', event.streamKey)

    this.#emitter.emit('event', { ...event, bus: this.#busId })
  }

  subscribe(handler) {
    this.#emitter.on('event', handler)

    return () => {
      this.#emitter.off('event', handler)
    }
  }
}

export default EventBus
