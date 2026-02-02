// src/domains/led/ledController.js
import LedScheduler from './ledScheduler.js'
import { validateLedConfig } from './ledValidate.js'

export default class LedController {
  #logger
  #ledBus
  #mainBus
  #clock
  #controllerId

  #controllerConfigRaw
  #devices

  #config
  #schedulersByLedId
  #unsubscribe

  constructor({ logger, ledBus, mainBus, clock, controllerId, controller, devices }) {
    this.#logger = logger
    this.#ledBus = ledBus
    this.#mainBus = mainBus
    this.#clock = clock
    this.#controllerId = controllerId || 'ledController'

    this.#controllerConfigRaw = controller || {}
    this.#devices = Array.isArray(devices) ? devices : []

    this.#config = null
    this.#schedulersByLedId = new Map()
    this.#unsubscribe = null

    if (!this.#mainBus?.subscribe) {
      throw new Error('ledController requires mainBus.subscribe')
    }

    if (!this.#ledBus?.publish) {
      throw new Error('ledController requires ledBus.publish')
    }
  }

  start() {
    if (this.#unsubscribe) return

    this.#config = validateLedConfig({ config: this.#controllerConfigRaw, logger: this.#logger })
    if (!this.#config?.enabled) {
      this.#logger.notice('led_controller_disabled', { controllerId: this.#controllerId })
      return
    }

    this.#buildSchedulers()

    this.#unsubscribe = this.#mainBus.subscribe((event) => {
      if (!event?.type) return
      this.#onMainEvent(event)
    })

    this.#logger.notice('led_controller_started', {
      controllerId: this.#controllerId,
      schedulers: this.#schedulersByLedId.size,
    })
  }

  dispose() {
    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    for (const s of this.#schedulersByLedId.values()) {
      s.dispose()
    }

    this.#schedulersByLedId.clear()
    this.#config = null

    this.#logger.notice('led_controller_disposed', { controllerId: this.#controllerId })
  }

  #buildSchedulers() {
    for (const d of this.#devices) {
      if (!d?.id) continue
      if (d?.enabled === false) continue

      const ledId = String(d.id)
      if (this.#schedulersByLedId.has(ledId)) continue

      const scheduler = new LedScheduler({
        logger: this.#logger,
        ledBus: this.#ledBus,
        clock: this.#clock,
        ledId,
        config: this.#config,
      })

      this.#schedulersByLedId.set(ledId, scheduler)
    }
  }

  #onMainEvent(event) {
    const rules = Array.isArray(this.#config?.rules) ? this.#config.rules : []
    if (rules.length === 0) return

    for (const rule of rules) {
      if (!rule?.on) continue
      if (rule.on !== event.type) continue
      if (!this.#matchWhen(rule.when, event)) continue

      const target = this.#resolveTarget(rule.target)
      if (!target?.ledId) {
        this.#logger.warning('led_rule_missing_target', { controllerId: this.#controllerId, rule })
        continue
      }

      const scheduler = this.#schedulersByLedId.get(target.ledId)
      if (!scheduler) {
        this.#logger.warning('led_rule_unknown_led', {
          controllerId: this.#controllerId,
          ledId: target.ledId,
          rule,
        })
        continue
      }

      const d = rule.do || {}
      const effectId = String(d.effect || '').trim()
      if (!effectId) {
        this.#logger.warning('led_rule_missing_effect', { controllerId: this.#controllerId, rule })
        continue
      }

      const ttlMs = d.ttlMs === null || d.ttlMs === undefined
        ? null
        : this.#toNonNegInt(d.ttlMs)

      scheduler.request({
        ledId: target.ledId,
        effectId,
        priority: Number.isFinite(Number(d.priority)) ? Number(d.priority) : 0,
        restore: Boolean(d.restore),
        ttlMs,
        interrupt: d.interrupt || 'ifLower',
        sourceEvent: event,
        source: this.#controllerId,
      })
    }
  }

  #matchWhen(when, event) {
    if (!when) return true

    const p = event?.payload || {}

    if (when.coreRole !== undefined) {
      if (String(p.coreRole || '') !== String(when.coreRole || '')) return false
    }

    if (when.hasTarget !== undefined) {
      const targets = Array.isArray(p.targets) ? p.targets : []
      const has = targets.length > 0
      if (Boolean(when.hasTarget) !== has) return false
    }

    return true
  }

  #resolveTarget(target) {
    if (!target || typeof target !== 'object') return null

    if (target.ledId) {
      return { ledId: String(target.ledId).trim() }
    }

    if (target.alias) {
      const alias = String(target.alias).trim()
      const entry = this.#config?.targets?.alias?.[alias]
      if (entry?.ledId) {
        return { ledId: String(entry.ledId).trim() }
      }
    }

    return null
  }

  #toNonNegInt(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.floor(n))
  }
}
