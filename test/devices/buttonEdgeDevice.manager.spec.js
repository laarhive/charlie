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

    const res = dm.inject('buttonVirt1', { edge: 'rising' })
    expect(res.ok).to.equal(true)

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(domainEvents.some((e) =>
      e.type === domainEventTypes.button.edge && e.payload?.edge === 'rising'
    )).to.equal(true)

    unsub()
    dm.dispose()
  })

  it('inject returns INVALID_INJECT_PAYLOAD for malformed payloads (instance exists)', function () {
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
    expect(res.error).to.equal('INVALID_INJECT_PAYLOAD')

    dm.dispose()
  })

  it('inject returns DEVICE_NOT_READY when device is present but instance is not created', function () {
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
          state: 'manualBlocked',
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

    const res = dm.inject('buttonVirt1', { edge: 'rising' })
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal('DEVICE_NOT_READY')

    dm.dispose()
  })
})
