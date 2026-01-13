import RuleEngine from './ruleEngine.js'
import PromptAssembler from './promptAssembler.js'

const CharlieCore = class CharlieCore {
  #clock
  #bus
  #scheduler
  #conversation
  #config
  #ruleEngine
  #promptAssembler

  #unsubscribe
  
  #state
  #stateVersion

  #presenceFront
  #presenceBack

  #armingToken
  #exitConfirmToken
  #cooldownToken

  #sessionActive
  #activeModeId
  #activeOpenerId
  #activeRuleId

  constructor({ clock, bus, scheduler, conversation, config }) {
    this.#clock = clock
    this.#bus = bus
    this.#scheduler = scheduler
    this.#conversation = conversation
    this.#config = config

    this.#ruleEngine = new RuleEngine({ rules: config.rules ?? [] })
    this.#promptAssembler = new PromptAssembler()

    this.#state = 'IDLE'
    this.#stateVersion = 0

    this.#presenceFront = false
    this.#presenceBack = false

    this.#armingToken = null
    this.#exitConfirmToken = null
    this.#cooldownToken = null

    this.#sessionActive = false
    this.#activeModeId = null
    this.#activeOpenerId = null
    this.#activeRuleId = null

    this.#unsubscribe = this.#bus.subscribe((event) => {
      this.#handleEvent(event)
    })
  }

  /**
   * @returns {object}
   *
   * @example
   * const s = core.getSnapshot()
   */
  getSnapshot() {
    return {
      state: this.#state,
      stateVersion: this.#stateVersion,
      presenceFront: this.#presenceFront,
      presenceBack: this.#presenceBack,
      presenceState: this.#getPresenceState(),
      sessionActive: this.#sessionActive,
      activeRuleId: this.#activeRuleId,
      activeModeId: this.#activeModeId,
      activeOpenerId: this.#activeOpenerId
    }
  }

  /**
   * @example
   * core.dispose()
   */
  dispose() {
    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = null
    }

    this.#cancelAllTimers()
  }

  #handleEvent(event) {
    if (event.type === 'presence:enter') {
      this.#setPresence(event.payload.zone, true)
      this.#onPresenceChanged()
      return
    }

    if (event.type === 'presence:exit') {
      this.#setPresence(event.payload.zone, false)
      this.#onPresenceChanged()
      return
    }

    if (event.type === 'time:armingExpired') {
      this.#onArmingExpired(event)
      return
    }

    if (event.type === 'time:exitConfirmExpired') {
      this.#onExitConfirmExpired(event)
      return
    }

    if (event.type === 'time:cooldownExpired') {
      this.#onCooldownExpired(event)
      return
    }
  }

  #setPresence(zone, present) {
    if (zone === 'front') {
      this.#presenceFront = present
      return
    }

    if (zone === 'back') {
      this.#presenceBack = present
    }
  }

  #getPresenceState() {
    if (this.#presenceFront && this.#presenceBack) {
      return 'BOTH'
    }

    if (this.#presenceFront) {
      return 'FRONT_ONLY'
    }

    if (this.#presenceBack) {
      return 'BACK_ONLY'
    }

    return 'NONE'
  }

  #onPresenceChanged() {
    if (this.#state === 'IDLE') {
      this.#maybeEnterArming()
      return
    }

    if (this.#state === 'ARMING') {
      const presenceState = this.#getPresenceState()
      if (presenceState === 'NONE') {
        this.#cancelTimer('arming')
        this.#transitionTo('IDLE')
      }

      return
    }

    if (this.#state === 'ACTIVE') {
      const presenceState = this.#getPresenceState()

      if (presenceState === 'NONE') {
        if (!this.#exitConfirmToken) {
          const exitConfirmMs = this.#config.timers?.exitConfirmMs ?? 2000
          this.#exitConfirmToken = this.#scheduler.scheduleIn({
            delayMs: exitConfirmMs,
            type: 'time:exitConfirmExpired',
            payload: { stateVersion: this.#stateVersion }
          })
        }

        return
      }

      if (this.#exitConfirmToken) {
        this.#cancelTimer('exitConfirm')
      }

      return
    }

    if (this.#state === 'COOLDOWN') {
      return
    }
  }

  #maybeEnterArming() {
    const now = this.#clock.nowMs()
    const presenceState = this.#getPresenceState()

    if (presenceState === 'NONE') {
      return
    }

    if (this.#cooldownToken) {
      return
    }

    const ctx = this.#buildRuleContext(now)
    const selection = this.#ruleEngine.select(ctx)
    const modeId = selection.actions?.modePromptId ?? null

    if (modeId === null) {
      return
    }

    this.#transitionTo('ARMING')

    const armingDelayMs = this.#config.timers?.armingDelayMs ?? 1200
    this.#armingToken = this.#scheduler.scheduleIn({
      delayMs: armingDelayMs,
      type: 'time:armingExpired',
      payload: { stateVersion: this.#stateVersion }
    })
  }

  #onArmingExpired(event) {
    if (!this.#isCurrentTimeEvent(event)) {
      return
    }

    const now = this.#clock.nowMs()
    const presenceState = this.#getPresenceState()

    this.#armingToken = null

    if (this.#state !== 'ARMING') {
      return
    }

    if (presenceState === 'NONE') {
      this.#transitionTo('IDLE')
      return
    }

    const ctx = this.#buildRuleContext(now)
    const selection = this.#ruleEngine.select(ctx)
    const modeId = selection.actions?.modePromptId ?? null

    if (modeId === null) {
      this.#transitionTo('IDLE')
      return
    }

    const openerId = selection.actions?.openerPromptId ?? null

    const baseText = this.#config.promptText?.base ?? ''
    const modeText = this.#config.promptText?.modes?.[modeId] ?? ''
    const openerText = openerId ? (this.#config.promptText?.openers?.[openerId] ?? '') : ''

    const prompt = this.#promptAssembler.assemble({
      base: baseText,
      mode: modeText,
      opener: openerText,
      meta: {
        presenceState,
        weekday: ctx.weekday,
        minuteOfDay: ctx.minuteOfDay
      }
    })

    this.#activeRuleId = selection.ruleId
    this.#activeModeId = modeId
    this.#activeOpenerId = openerId

    this.#conversation.startConversation({
      requestId: `req_${now}_start`,
      modeId,
      openerId,
      prompt
    })

    this.#sessionActive = true
    this.#transitionTo('ACTIVE')
  }

  #onExitConfirmExpired(event) {
    if (!this.#isCurrentTimeEvent(event)) {
      return
    }

    this.#exitConfirmToken = null

    if (this.#state !== 'ACTIVE') {
      return
    }

    const presenceState = this.#getPresenceState()
    if (presenceState !== 'NONE') {
      return
    }

    const now = this.#clock.nowMs()

    if (this.#sessionActive) {
      this.#conversation.stopConversation({ requestId: `req_${now}_stop`, reason: 'no_presence' })
    }

    this.#sessionActive = false
    this.#activeRuleId = null
    this.#activeModeId = null
    this.#activeOpenerId = null

    this.#transitionTo('COOLDOWN')

    const cooldownMs = this.#config.timers?.conversationCooldownMs ?? 60000
    this.#cooldownToken = this.#scheduler.scheduleIn({
      delayMs: cooldownMs,
      type: 'time:cooldownExpired',
      payload: { stateVersion: this.#stateVersion }
    })
  }

  #onCooldownExpired(event) {
    if (!this.#isCurrentTimeEvent(event)) {
      return
    }

    this.#cooldownToken = null

    if (this.#state !== 'COOLDOWN') {
      return
    }

    this.#transitionTo('IDLE')
  }

  #transitionTo(state) {
    if (this.#state === state) {
      return
    }

    this.#state = state
    this.#stateVersion += 1

    if (state === 'IDLE') {
      this.#cancelAllTimers()
      return
    }

    if (state === 'ARMING') {
      this.#cancelTimer('exitConfirm')
      this.#cancelTimer('cooldown')
      return
    }

    if (state === 'ACTIVE') {
      this.#cancelTimer('arming')
      this.#cancelTimer('cooldown')
      return
    }

    if (state === 'COOLDOWN') {
      this.#cancelTimer('arming')
      this.#cancelTimer('exitConfirm')
    }
  }

  #cancelAllTimers() {
    this.#cancelTimer('arming')
    this.#cancelTimer('exitConfirm')
    this.#cancelTimer('cooldown')
  }

  #cancelTimer(kind) {
    if (kind === 'arming' && this.#armingToken) {
      this.#scheduler.cancel(this.#armingToken)
      this.#armingToken = null
      return
    }

    if (kind === 'exitConfirm' && this.#exitConfirmToken) {
      this.#scheduler.cancel(this.#exitConfirmToken)
      this.#exitConfirmToken = null
      return
    }

    if (kind === 'cooldown' && this.#cooldownToken) {
      this.#scheduler.cancel(this.#cooldownToken)
      this.#cooldownToken = null
    }
  }

  #isCurrentTimeEvent(event) {
    const evVer = event.payload?.stateVersion
    return evVer === this.#stateVersion
  }

  #buildRuleContext(nowMs) {
    const t = this.#clock.toLocalParts(nowMs)
    const minuteOfDay = t.hour * 60 + t.minute

    return {
      zone: this.#presenceFront ? 'front' : 'back',
      weekday: t.weekday,
      minuteOfDay
    }
  }
}

export default CharlieCore
