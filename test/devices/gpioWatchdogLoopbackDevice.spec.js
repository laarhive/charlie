// test/devices/gpioWatchdogLoopbackDevice.spec.js
import EventBus from '../../src/core/eventBus.js'
import GpioWatchdogLoopbackDevice from '../../src/devices/kinds/gpioWatchdogLoopback/gpioWatchdogLoopbackDevice.js'
import { runDeviceConformanceTests } from './shared/deviceConformance.js'

const makeClock = function makeClock() {
  let now = 0

  return {
    nowMs: () => now,
    advance: (ms) => { now += ms },
  }
}

const makeHarness = function makeHarness() {
  const clock = makeClock()
  const mainBus = new EventBus({ busId: 'main' })
  const domainBus = new EventBus({ busId: 'watchdog' })

  const device = new GpioWatchdogLoopbackDevice({
    logger: { error: () => {}, notice: () => {} },
    clock,
    buses: { main: mainBus, watchdog: domainBus },
    device: {
      id: 'gpioWatchdog1',
      publishAs: 'gpioWatchdog1',
      domain: 'watchdog',
      kind: 'gpioWatchdogLoopback',
      protocol: { outLine: 17, inLine: 27, chip: 'gpiochip0' },
      params: { toggleMs: 1000, bias: 'pull-down' },
    },
  })

  return {
    clock,
    mainBus,
    domainBus,
    device,
    expectsDomainEvents: false,
  }
}

describe('Empty', function () {})

runDeviceConformanceTests({
  name: 'GpioWatchdogLoopbackDevice',
  makeHarness,
})
