// src/devices/base/baseDevice.js
export default class BaseDevice {
  #device
  #runtimeState

  constructor(device) {
    this.#device = device
    this.#runtimeState = 'unknown'
  }

  getId() {
    return this.#device.id
  }

  getPublishAs() {
    return this.#device.publishAs ?? this.#device.id
  }

  getDomain() {
    return this.#device.domain ?? this.#device.role ?? null
  }

  getRole() {
    return this.#device.role ?? null
  }

  getKind() {
    return this.#device.kind ?? null
  }

  getConfiguredState() {
    return this.#device.state ?? 'active'
  }

  getRuntimeState() {
    return this.#runtimeState
  }

  _setRuntimeState(state) {
    this.#runtimeState = state
  }
}
