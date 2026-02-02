import EventBus from '../../src/core/eventBus.js'
import { DeviceManager } from '../../src/devices/deviceManager.js'
import { runDeviceManagerUnitConformanceTests } from './shared/deviceManagerUnitConformance.js'

const makeClock = function makeClock() {
  let now = 0

  return {
    nowMs: () => now,
    advance: (ms) => { now += ms },
  }
}

const makeLogger = function makeLogger() {
  return { error: () => {} }
}

const makeHarness = function makeHarness() {
  const clock = makeClock()
  const mainBus = new EventBus()

  const buses = {
    main: mainBus,
    button: new EventBus(),
    watchdog: new EventBus(),
  }

  /*
   * DeviceManager unit tests should assume config is already in "runtime" form:
   * - devices are already filtered to the selected mode
   * - per-device `modes` does not exist anymore
   */
  const config = {
    devices: [
      {
        id: 'manualBlocked1',
        publishAs: 'button1',
        domain: 'button',
        kind: 'buttonEdge',
        protocol: { type: 'virt', initial: false },
        state: 'manualBlocked',
      },
      {
        id: 'bad1',
        publishAs: 'bad1',
        domain: 'main',
        kind: 'nope',
        protocol: { type: 'virt', initial: false },
        state: 'active',
      }
    ]
  }

  const dm = new DeviceManager({
    logger: makeLogger(),
    mainBus,
    buses,
    clock,
    config,
  })

  return {
    clock,
    mainBus,
    buses,
    dm,
    expect: {
      visibleIds: ['manualBlocked1', 'bad1'],
      manualBlockedId: 'manualBlocked1',
      badKindId: 'bad1',
    },
  }
}

describe('DeviceManager – unit conformance', function () {
  runDeviceManagerUnitConformanceTests({ makeHarness })
})
