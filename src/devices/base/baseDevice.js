// src/devices/base/baseDevice.js
/**
 * Base class for all hardware and virtual devices.
 *
 * Responsibilities:
 * - Holds immutable device configuration (id, kind, domain, publishAs)
 * - Manages lifecycle state: blocked / unblocked / disposed
 * - Defines a strict contract for derived devices
 *
 * Design rules:
 * - DeviceManager only calls block(), unblock(), start(), dispose()
 * - Device decides what those mean internally
 * - Calling unblock() on an already-active device is a no-op
 * - start() is idempotent
 *
 * Runtime model:
 * - "blocked" means device must not interact with hardware or emit domain events
 * - "disposed" is terminal and irreversible
 * - Errors are stored but not thrown during runtime
 *
 * Derived classes MUST implement:
 * - _startImpl()
 * - _stopImpl(reason)
 *
 * They MAY implement:
 * - inject(payload) for virtual / testing control
 *
 * This class intentionally contains no domain logic.
 *
 * @example
 * class MyDevice extends BaseDevice {
 *   _startImpl() {
 *     // initialize protocol, subscribe, emit active
 *   }
 *
 *   _stopImpl(reason) {
 *     // cleanup resources
 *   }
 * }
 */

export default class BaseDevice {
  #device
  #blocked
  #disposed
  #lastError

  constructor(device) {
    if (!device?.id) {
      throw new Error('BaseDevice requires device.id')
    }

    this.#device = device
    this.#blocked = false
    this.#disposed = false
    this.#lastError = null
  }

  getId() {
    return this.#device.id
  }

  getPublishAs() {
    return this.#device.publishAs ?? this.#device.id
  }

  getKind() {
    return this.#device.kind ?? null
  }

  getDomain() {
    return this.#device.domain ?? null
  }

  getConfiguredState() {
    return this.#device.state ?? 'active'
  }

  isBlocked() {
    return this.#blocked
  }

  isDisposed() {
    return this.#disposed
  }

  getLastError() {
    return this.#lastError
  }

  _device() {
    return this.#device
  }

  _setBlocked(v) {
    this.#blocked = Boolean(v)
  }

  _setLastError(msg) {
    this.#lastError = msg ? String(msg) : null
  }

  /**
   * Derived classes must implement:
   * - _startImpl()
   * - _stopImpl()
   *
   * No JSDoc here by design.
   */

  start() {
    if (this.#disposed || this.#blocked) {
      return
    }

    this._startImpl()
  }

  inject(payload) {
    void payload
    return err('INVALID_INJECT_PAYLOAD')
  }

  block(reason) {
    if (this.#disposed) {
      return
    }

    if (this.#blocked) {
      return
    }

    this.#blocked = true
    this._stopImpl(reason)
  }

  unblock() {
    if (this.#disposed) {
      return
    }

    if (!this.#blocked) {
      return
    }

    this.#blocked = false
    this._startImpl()
  }

  dispose() {
    if (this.#disposed) {
      return
    }

    this.#disposed = true
    this.#blocked = true
    this._stopImpl('dispose')
  }

  getSnapshot() {
    return {
      id: this.getId(),
      publishAs: this.getPublishAs(),
      kind: this.getKind(),
      domain: this.getDomain(),
      configuredState: this.getConfiguredState(),
      blocked: this.#blocked,
      disposed: this.#disposed,
      lastError: this.#lastError,
    }
  }

  /* override in derived */
  _startImpl() {
    throw new Error('BaseDevice._startImpl not implemented')
  }

  /* override in derived */
  _stopImpl(reason) {
    void reason
    throw new Error('BaseDevice._stopImpl not implemented')
  }
}
