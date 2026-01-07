// src/hw/sensorsController.js
import Ld2410PresenceSource from './sources/ld2410PresenceSource.js'
import Sw420VibrationSource from './sources/sw420VibrationSource.js'
import GpioButtonSource from './sources/gpioButtonSource.js'

export class SensorsController {
  #logger
  #bus
  #clock
  #config
  #inputs
  #sources

  constructor({ logger, bus, clock, config, inputs }) {
    this.#logger = logger
    this.#bus = bus
    this.#clock = clock
    this.#config = config
    this.#inputs = inputs
    this.#sources = []
  }

  /**
   * Starts all enabled sensors.
   *
   * @example
   * sensorsController.start()
   */
  start() {
    const sensors = Array.isArray(this.#config?.sensors) ? this.#config.sensors : []

    for (const sensor of sensors) {
      if (!sensor?.enabled) {
        continue
      }

      const source = this.#makeSource(sensor)
      if (!source) {
        continue
      }

      source.start()
      this.#sources.push(source)
    }

    this.#logger.notice('sensors_started', { sources: this.#sources.length })
  }

  /**
   * Disposes all sources.
   *
   * @example
   * sensorsController.dispose()
   */
  dispose() {
    for (const s of this.#sources) {
      s.dispose()
    }

    this.#sources = []
    this.#logger.notice('sensors_disposed', {})
  }

  #makeSource(sensor) {
    const input = this.#inputs.get(sensor.id)
    if (!input) {
      this.#logger.warning('sensor_missing_input', { sensorId: sensor.id, type: sensor.type, role: sensor.role })
      return null
    }

    if (sensor.role === 'presence' && sensor.type === 'ld2410') {
      return new Ld2410PresenceSource({ logger: this.#logger, bus: this.#bus, clock: this.#clock, sensor, input })
    }

    if (sensor.role === 'vibration' && sensor.type === 'sw420') {
      return new Sw420VibrationSource({ logger: this.#logger, bus: this.#bus, clock: this.#clock, sensor, input })
    }

    if (sensor.role === 'button' && sensor.type === 'gpioButton') {
      return new GpioButtonSource({ logger: this.#logger, bus: this.#bus, clock: this.#clock, sensor, input })
    }

    this.#logger.warning('sensor_unsupported', { sensorId: sensor.id, type: sensor.type, role: sensor.role })
    return null
  }
}

export default SensorsController
