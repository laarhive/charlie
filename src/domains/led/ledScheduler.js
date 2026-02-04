// src/domains/led/ledScheduler.js
import domainEventTypes from '../domainEventTypes.js'
import { createEffectRunner } from './ledEffects.js'

export default class LedScheduler {
  #logger
  #ledBus
  #clock
  #ledId
  #config
  #active
  #stack
  #timer
  #lastRgb

  constructor({ logger, ledBus, clock, ledId, config }) {
    this.#logger = logger
    this.#ledBus = ledBus
    this.#clock = clock
    this.#ledId = ledId
    this.#config = config
    this.#active = null
    this.#stack = []
    this.#timer = null
    this.#lastRgb = [0, 0, 0]
  }

  dispose() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#active = null
    this.#stack = []
  }

  request(req) {
    const now = this.#clock.nowMs()

    if (this.#active) {
      const cur = this.#active.request

      const sameEffect = req.effectId === cur.effectId && req.priority === cur.priority
      if (sameEffect) {
        // soft update: update event context only, keep phase/intensity
        cur.sourceEvent = req.sourceEvent
        return
      }
    }

    if (!this.#accept(req)) return

    if (this.#active && req.restore && req.priority > this.#active.request.priority) {
      this.#stack.push(this.#active)
    }

    const requestRef = {
      ...req,
      sourceEvent: req.sourceEvent,
    }

    this.#active = {
      request: requestRef,
      runner: createEffectRunner({
        effectDef: this.#config.effects[req.effectId],
        config: this.#config,
        initialRgb: this.#lastRgb,
        requestRef,
        clockNowMs: now,
      }),
      expiresAt: req.ttlMs === null ? null : now + req.ttlMs,
    }

    this.#schedule(0)
  }

  #accept(req) {
    if (!this.#active) return true
    if (req.interrupt === 'always') return true
    if (req.interrupt === 'never') return false
    return req.priority >= this.#active.request.priority
  }

  #schedule(ms) {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#tick(), ms)
  }

  #tick() {
    const now = this.#clock.nowMs()
    const a = this.#active
    if (!a) return

    if (a.expiresAt !== null && now >= a.expiresAt) {
      this.#finish()
      return
    }

    const step = a.runner.next(now)
    if (!step) return this.#finish()

    if (step.rgb) {
      this.#lastRgb = step.rgb
      this.#emit(step.rgb)
    }

    if (step.done) {
      this.#finish()
      return
    }

    this.#schedule(step.nextInMs ?? 30)
  }

  #finish() {
    this.#active = this.#stack.pop() || null
    if (this.#active) this.#schedule(0)
  }

  #emit(rgb) {
    this.#ledBus.publish({
      type: domainEventTypes.led.command,
      ts: this.#clock.nowMs(),
      source: 'ledScheduler',
      payload: {
        ledId: this.#ledId,
        publishAs: null,
        rgb,
      },
    })
  }
}
