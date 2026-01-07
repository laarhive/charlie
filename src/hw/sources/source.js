// src/hw/sources/source.js
export class Source {
  /**
   * Start reading input and publishing events.
   *
   * @example
   * source.start()
   */
  start() {
    throw new Error('not implemented')
  }

  /**
   * Stop and cleanup resources.
   *
   * @example
   * source.dispose()
   */
  dispose() {
    throw new Error('not implemented')
  }
}

export default Source
