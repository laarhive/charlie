const StateMachine = class StateMachine {
  #state
  #activeZone

  constructor() {
    this.#state = 'IDLE'
    this.#activeZone = 'none'
  }

  /**
   * @returns {{ state: 'IDLE'|'ARMING'|'ACTIVE'|'COOLDOWN', activeZone: 'none'|'front'|'back' }}
   *
   * @example
   * const sm = new StateMachine()
   * const snapshot = sm.getSnapshot()
   * // snapshot.state === 'IDLE'
   */
  getSnapshot() {
    return { state: this.#state, activeZone: this.#activeZone }
  }

  /**
   * @param {'none'|'front'|'back'} zone
   */
  setActiveZone(zone) {
    this.#activeZone = zone
  }

  /**
   * @param {'IDLE'|'ARMING'|'ACTIVE'|'COOLDOWN'} state
   */
  setState(state) {
    this.#state = state
  }
}

export default StateMachine
