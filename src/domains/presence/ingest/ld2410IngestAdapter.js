// src/domains/presence/ingest/ld2410IngestAdapter.js
import domainEventTypes from '../../domainEventTypes.js'
import { makeStreamKey } from '../../../core/eventBus.js'
import eventTypes from '../../../core/eventTypes.js'
import { busIds } from '../../../app/buses.js'

export class Ld2410IngestAdapter {
  #logger
  #clock
  #controllerId

  #presenceBus
  #presenceInternalBus

  #devicesByPublishAs
  #cfgByPublishAs

  #rawByPublishAs
  #stableByPublishAs
  #timersByPublishAs

  #unsubscribe

  constructor({ logger, clock, controllerId, presenceBus, presenceInternalBus, controllerConfig, devices }) {
    this.#logger = logger
    this.#clock = clock
    this.#controllerId = controllerId || 'ld2410IngestAdapter'

    this.#presenceBus = presenceBus
    this.#presenceInternalBus = presenceInternalBus

    this.#devicesByPublishAs = new Map()
    this.#cfgByPublishAs = new Map()

    this.#rawByPublishAs = new Map()
    this.#stableByPublishAs = new Map()
    this.#timersByPublishAs = new Map()

    this.#unsubscribe = null

    const list = Array.isArray(devices) ? devices : []
    for (const d of list) {
      const publishAs = String(d?.publishAs || '').trim()
      if (!publishAs) continue
      this.#devicesByPublishAs.set(publishAs, d)
    }

    this.#initConfig(controllerConfig || {})

    if (!this.#presenceBus?.subscribe) {
      throw new Error('Ld2410IngestAdapter requires presenceBus.subscribe')
    }

    if (!this.#presenceInternalBus?.publish) {
      throw new Error('Ld2410IngestAdapter requires presenceInternalBus.publish')
    }
  }

  get streamKeyWho() { return 'ld2410IngestAdapter' }

  start() {
    if (this.#unsubscribe) return

    this.#unsubscribe = this.#presenceBus.subscribe((event) => {
      if (event?.type !== domainEventTypes.presence.ld2410) return
      this.#onLd2410Raw(event)
    })
  }

  dispose() {
    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    for (const timer of this.#timersByPublishAs.values()) {
      clearTimeout(timer)
    }

    this.#timersByPublishAs.clear()
    this.#rawByPublishAs.clear()
    this.#stableByPublishAs.clear()
  }

  #initConfig(cfg) {
    this.#debounce = cfg?.ld2410?.debounce || {}
    const layout = cfg?.layout || {}
    const list = Array.isArray(layout?.ld2410) ? layout.ld2410 : []

    const enabledDefault = cfg?.ld2410?.enabledDefault === true

    for (const entry of list) {
      const publishAs = String(entry?.publishAs || '').trim()
      if (!publishAs) continue

      const zoneId = String(entry?.zoneId || '').trim()
      if (!zoneId) continue

      const enabled = entry?.enabled === undefined ? enabledDefault : (entry.enabled !== false)

      this.#cfgByPublishAs.set(publishAs, { publishAs, zoneId, enabled })

      this.#rawByPublishAs.set(publishAs, false)
      this.#stableByPublishAs.set(publishAs, false)
    }
  }

  #deviceUsable(device) {
    if (!device) return false
    if (device.enabled === false) return false
    return String(device.state || 'active') === 'active'
  }

  #onLd2410Raw(event) {
    const p = event?.payload || {}
    const publishAs = String(p.publishAs || '').trim()
    if (!publishAs) return

    const device = this.#devicesByPublishAs.get(publishAs)
    if (!this.#deviceUsable(device)) {
      return
    }

    const cfg = this.#cfgByPublishAs.get(publishAs)
    if (!cfg || cfg.enabled === false) {
      return
    }

    const frame = p.frame || {}
    const present = Boolean(frame.present)

    this.#rawByPublishAs.set(publishAs, present)

    const onMs = this.#toNonNegInt(this.#getDebounceMs('onConfirmMs', 150))
    const offMs = this.#toNonNegInt(this.#getDebounceMs('offConfirmMs', 600))
    const delayMs = present ? onMs : offMs

    this.#scheduleStable(publishAs, { zoneId: cfg.zoneId, present, delayMs })
  }

  #getDebounceMs(key, fallback) {
    return this.#debounce?.[key] ?? fallback
  }

  #scheduleStable(publishAs, { zoneId, present, delayMs }) {
    this.#clearTimer(publishAs)

    if (delayMs <= 0) {
      this.#applyStable(publishAs, { zoneId, present })
      return
    }

    const timer = setTimeout(() => {
      this.#timersByPublishAs.delete(publishAs)

      const rawNow = this.#rawByPublishAs.get(publishAs)
      if (rawNow !== present) {
        return
      }

      this.#applyStable(publishAs, { zoneId, present })
    }, delayMs)

    this.#timersByPublishAs.set(publishAs, timer)
  }

  #applyStable(publishAs, { zoneId, present }) {
    const stable = this.#stableByPublishAs.get(publishAs)
    if (stable === present) return

    this.#stableByPublishAs.set(publishAs, present)

    this.#presenceInternalBus.publish({
      type: domainEventTypes.presence.ld2410Stable,
      ts: this.#clock.nowMs(),
      source: this.#controllerId,
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: domainEventTypes.presence.ld2410Stable,
        where: busIds.presenceInternal,
      }),
      payload: {
        zoneId,
        present,
        publishAs,
      },
    })
  }

  #clearTimer(publishAs) {
    const timer = this.#timersByPublishAs.get(publishAs)
    if (!timer) return
    clearTimeout(timer)
    this.#timersByPublishAs.delete(publishAs)
  }

  #toNonNegInt(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.floor(n))
  }

  // Internal cache of debounce config
  #debounce = null
}

export default Ld2410IngestAdapter
