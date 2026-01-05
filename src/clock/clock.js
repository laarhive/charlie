export class Clock {
  #tzOffsetMs
  #isFrozen
  #frozenNowMs
  #offsetMs
  #realNow
  #changeListeners

  constructor({ tzOffsetMinutes = 480, realNowMs } = {}) {
    this.#tzOffsetMs = tzOffsetMinutes * 60 * 1000
    this.#isFrozen = false
    this.#frozenNowMs = 0
    this.#offsetMs = 0
    this.#realNow = typeof realNowMs === 'function' ? realNowMs : () => Date.now()
    this.#changeListeners = new Set()
  }

  nowMs() {
    if (this.#isFrozen) {
      return this.#frozenNowMs
    }

    return this.#realNow() + this.#offsetMs
  }

  onChange(handler) {
    this.#changeListeners.add(handler)

    return () => {
      this.#changeListeners.delete(handler)
    }
  }

  freeze() {
    if (!this.#isFrozen) {
      this.#frozenNowMs = this.nowMs()
      this.#isFrozen = true
      this.#emitChange({ reason: 'freeze' })
    }
  }

  resume() {
    if (this.#isFrozen) {
      const realNow = this.#realNow()
      this.#offsetMs = this.#frozenNowMs - realNow
      this.#isFrozen = false
      this.#emitChange({ reason: 'resume' })
    }
  }

  setNowMs(nowMs) {
    if (this.#isFrozen) {
      this.#frozenNowMs = nowMs
      this.#emitChange({ reason: 'setNowMs' })
      return
    }

    const realNow = this.#realNow()
    this.#offsetMs = nowMs - realNow
    this.#emitChange({ reason: 'setNowMs' })
  }

  advance(ms) {
    if (this.#isFrozen) {
      this.#frozenNowMs += ms
      this.#emitChange({ reason: 'advance', deltaMs: ms })
      return
    }

    this.#offsetMs += ms
    this.#emitChange({ reason: 'advance', deltaMs: ms })
  }

  setTzOffsetMinutes(minutes) {
    this.#tzOffsetMs = minutes * 60 * 1000
    this.#emitChange({ reason: 'tzChanged' })
  }

  toLocalParts(ms = this.nowMs()) {
    const adjustedMs = ms + this.#tzOffsetMs
    const d = new Date(adjustedMs)

    const utcDay = d.getUTCDay()
    const weekday = ((utcDay + 6) % 7) + 1

    return {
      weekday,
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes()
    }
  }

  setLocalDateTime({ year, month, day, hour, minute }) {
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - this.#tzOffsetMs
    this.setNowMs(utcMs)
  }

// src/time/clock.js (additions)

  isFrozen() {
    return this.#isFrozen
  }

  #emitChange(info) {
    const payload = {
      ...info,
      nowMs: this.nowMs(),
      isFrozen: this.#isFrozen
    }

    for (const handler of this.#changeListeners) {
      handler(payload)
    }
  }
}

export default Clock
