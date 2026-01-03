export class RuleEngine {
  #rules

  constructor({ rules = [] } = {}) {
    this.#rules = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  }

  /**
   * Selects the first matching enabled rule.
   *
   * @param {object} context
   * @param {'front'|'back'} context.zone
   * @param {number} context.weekday - 1..7 (1=Mon)
   * @param {number} context.minuteOfDay - 0..1439
   * @returns {{ ruleId: string|null, actions: object|null }}
   *
   * @example
   * const engine = new RuleEngine({ rules })
   * const res = engine.select({ zone: 'front', weekday: 1, minuteOfDay: 9 * 60 })
   * // res.actions.modePromptId could be 'mode.front.morning' or null
   */
  select(context) {
    for (const rule of this.#rules) {
      if (rule.enabled === 0) {
        continue
      }

      if (!this.#matches(rule, context)) {
        continue
      }

      return { ruleId: rule.id ?? null, actions: rule.actions ?? null }
    }

    return { ruleId: null, actions: null }
  }

  #matches(rule, context) {
    const conditions = rule.conditions ?? {}

    if (conditions.zone && conditions.zone !== context.zone) {
      return false
    }

    if (Array.isArray(conditions.weekday) && conditions.weekday.length > 0) {
      if (!conditions.weekday.includes(context.weekday)) {
        return false
      }
    }

    const timeRanges = conditions.timeRanges ?? []
    if (timeRanges.length > 0) {
      const anyMatch = timeRanges.some((r) => (this.#timeRangeMatches(r, context.minuteOfDay)))
      if (!anyMatch) {
        return false
      }
    }

    return true
  }

  #timeRangeMatches(range, minuteOfDay) {
    const start = this.#parseHHMM(range.start)
    const end = this.#parseHHMM(range.end)

    if (start === null || end === null) {
      return false
    }

    if (start === end) {
      /* treat as full-day disabled or enabled depending on rule intent; here: match always */
      return true
    }

    if (end > start) {
      return minuteOfDay >= start && minuteOfDay < end
    }

    /* overnight range, e.g. 22:00–08:00 */
    return minuteOfDay >= start || minuteOfDay < end
  }

  #parseHHMM(hhmm) {
    if (typeof hhmm !== 'string') {
      return null
    }

    const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
    if (!m) {
      return null
    }

    const hh = Number(m[1])
    const mm = Number(m[2])

    if (Number.isNaN(hh) || Number.isNaN(mm)) {
      return null
    }

    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      return null
    }

    return hh * 60 + mm
  }
}

export default RuleEngine
