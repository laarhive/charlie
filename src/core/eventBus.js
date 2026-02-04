// src/core/eventBus.js
import { EventEmitter } from 'node:events'

const EventBus = class EventBus {
  #emitter

  constructor() {
    this.#emitter = new EventEmitter()
  }

  /**
   * Publishes an event to all subscribers.
   *
   * @param {object} event
   *
   * @example
   * bus.publish({ type: 'presence:enter', ts: 0, source: 'sim', payload: { zone: 'front' } })
   */
  publish(event) {
    this.#emitter.emit('event', event)
  }

  /**
   * Subscribes to all events.
   *
   * @param {function} handler
   *
   * @example
   * const unsubscribe = bus.subscribe((event) => console.log(event.type))
   */
  subscribe(handler) {
    this.#emitter.on('event', handler)

    return () => {
      this.#emitter.off('event', handler)
    }
  }
}

export default EventBus
