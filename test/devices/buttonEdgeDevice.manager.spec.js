// test/devices/buttonEdgeDevice.manager.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import { DeviceManager } from '../../src/devices/deviceManager.js'
import domainEventTypes from '../../src/domains/domainEventTypes.js'

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

describe('ButtonEdgeDevice – DeviceManager integration', function () {
  it('inject forwards to the device instance (domain event observed)', async function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = {
      main: mainBus,
      button: buttonBus,
    }

    const config = {
      devices: [
        {
          id: 'buttonVirt1',
          publishAs: 'button1',
          domain: 'button',
          kind: 'buttonEdge',
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

    const domainEvents = []
    const unsub = buttonBus.subscribe((e) => domainEvents.push(e))

    dm.start()

    const res = dm.inject('buttonVirt1', 'press 1')
    expect(res.ok).to.equal(true)

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(domainEvents.some((e) => e.type === domainEventTypes.button.edge)).to.equal(true)

    unsub()
    dm.dispose()
  })

  it('inject propagates device NOT_SUPPORTED (no override)', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = {
      main: mainBus,
      button: buttonBus,
    }

    const config = {
      devices: [
        {
          id: 'buttonVirt1',
          publishAs: 'button1',
          domain: 'button',
          kind: 'buttonEdge',
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

    dm.start()

    const res = dm.inject('buttonVirt1', undefined)
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal('NOT_SUPPORTED')

    dm.dispose()
  })
})
