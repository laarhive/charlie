// src/hw/io/digitalInput.js
export class DigitalInput {
  /**
   * Subscribe to changes. Handler receives boolean (true = high).
   *
   * @param {(value: boolean) => void} handler
   * @returns {() => void} unsubscribe
   *
   * @example
   * const unsub = input.subscribe((value) => console.log('changed', value))
   * unsub()
   */
  subscribe(handler) {
    throw new Error('not implemented')
  }

  /**
   * Read current state if supported.
   *
   * @returns {boolean}
   *
   * @example
   * const v = input.read()
   */
  read() {
    throw new Error('not implemented')
  }
}

export default DigitalInput
