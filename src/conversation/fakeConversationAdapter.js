export class FakeConversationAdapter {
  #starts
  #stops

  constructor() {
    this.#starts = []
    this.#stops = []
  }

  /**
   * Records conversation start payload.
   *
   * @param {object} payload
   *
   * @example
   * adapter.startConversation({ zone: 'front', prompt: '...' })
   */
  startConversation(payload) {
    this.#starts.push(payload)
  }

  /**
   * Records conversation stop payload.
   *
   * @param {object} payload
   *
   * @example
   * adapter.stopConversation({ reason: 'no_presence' })
   */
  stopConversation(payload) {
    this.#stops.push(payload)
  }

  /**
   * @returns {object}
   *
   * @example
   * const { starts, stops } = adapter.getCalls()
   */
  getCalls() {
    return { starts: [...this.#starts], stops: [...this.#stops] }
  }
}

export default FakeConversationAdapter
