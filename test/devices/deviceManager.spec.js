// test/devices/deviceManager.spec.js
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

  const config = {
    devices: [
      {
        id: 'manualBlocked1',
        publishAs: 'button1',
        domain: 'button',
        kind: 'buttonEdge',
        protocol: { type: 'virt', initial: false },
        modes: ['win11'],
        state: 'manualBlocked',
      },
      {
        id: 'rpiOnly1',
        publishAs: 'button2',
        domain: 'button',
        kind: 'buttonEdge',
        protocol: { type: 'virt', initial: false },
        modes: ['rpi4'],
        state: 'manualBlocked',
      },
      {
        id: 'bad1',
        publishAs: 'bad1',
        domain: 'main',
        kind: 'nope',
        protocol: { type: 'virt', initial: false },
        modes: ['win11'],
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
    mode: 'win11',
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
