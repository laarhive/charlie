// test/devices/deviceManager.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import { DeviceManager } from '../../src/devices/deviceManager.js'

const makeClock = function makeClock() {
  let now = 0

  return {
    nowMs: () => now,
    advance: (ms) => { now += ms },
  }
}

const makeLogger = function makeLogger() {
  return {
    error: () => {},
  }
}

describe('DeviceManager', function () {
  it('filters devices by mode', function () {
    const clock = makeClock()
    const mainBus = new EventBus()

    const buses = {
      main: mainBus,
      button: new EventBus(),
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
        },
        {
          id: 'buttonRpiOnly',
          publishAs: 'button2',
          domain: 'button',
          kind: 'buttonEdge',
          protocol: { type: 'virt', initial: false },
          modes: ['rpi4'],
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

    const listed = dm.list().devices.map((d) => d.id)
    expect(listed).to.deep.equal(['buttonVirt1'])

    dm.dispose()
  })

  it('block/unblock is idempotent and updates state', function () {
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
          params: { cooldownMs: 250 },
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

    const first = dm.unblock('buttonVirt1')
    expect(first.ok).to.equal(true)
    expect(first.note).to.equal('already_active')

    const b = dm.block('buttonVirt1', 'test')
    expect(b.ok).to.equal(true)

    const listed1 = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(listed1.state).to.equal('manualBlocked')

    const u = dm.unblock('buttonVirt1', 'test')
    expect(u.ok).to.equal(true)

    const listed2 = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(listed2.state).to.equal('active')

    dm.dispose()
  })

  it('forwards inject to the device instance', async function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = {
      main: mainBus,
      button: buttonBus,
    }

    const domainEvents = []
    const unsub = buttonBus.subscribe((e) => domainEvents.push(e))

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

    const res = dm.inject('buttonVirt1', 'press 1')
    expect(res.ok).to.equal(true)

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(domainEvents.some((e) => e.type === 'buttonRaw:edge')).to.equal(true)

    unsub()
    dm.dispose()
  })

  it('does not start devices configured as manualBlocked', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = { main: mainBus, button: buttonBus }

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

    const row = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(row.started).to.equal(false)
    expect(row.state).to.equal('manualBlocked')

    dm.dispose()
  })

  it('unblock() starts a manualBlocked device that was not started yet', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = { main: mainBus, button: buttonBus }

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

    const before = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(before.started).to.equal(false)
    expect(before.state).to.equal('manualBlocked')

    const res = dm.unblock('buttonVirt1', 'test')
    expect(res.ok).to.equal(true)

    const after = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(after.started).to.equal(true)
    expect(after.state).to.equal('active')

    dm.dispose()
  })

  it('block() is stable when called repeatedly', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = { main: mainBus, button: buttonBus }

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

    const a = dm.block('buttonVirt1', 'test')
    expect(a.ok).to.equal(true)

    const b = dm.block('buttonVirt1', 'test2')
    expect(b.ok).to.equal(true)

    const row = dm.list().devices.find((d) => d.id === 'buttonVirt1')
    expect(row.state).to.equal('manualBlocked')

    dm.dispose()
  })

  it('inject() returns DEVICE_NOT_FOUND for unknown id', function () {
    const clock = makeClock()
    const mainBus = new EventBus()

    const dm = new DeviceManager({
      logger: makeLogger(),
      mainBus,
      buses: { main: mainBus },
      clock,
      config: { devices: [] },
      mode: 'win11',
    })

    dm.start()

    const res = dm.inject('nope', 'press 1')
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal('DEVICE_NOT_FOUND')

    dm.dispose()
  })

  it('inject() returns NOT_SUPPORTED if instance has no inject()', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buttonBus = new EventBus()

    const buses = { main: mainBus, button: buttonBus }

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

    const res = dm.inject('buttonVirt1', 'anything')
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal('NOT_SUPPORTED')

    dm.dispose()
  })

  it('bad kind causes create failure and state becomes degraded', function () {
    const clock = makeClock()
    const mainBus = new EventBus()
    const buses = { main: mainBus }

    const config = {
      devices: [
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

    dm.start()

    const row = dm.list().devices.find((d) => d.id === 'bad1')
    expect(row.started).to.equal(false)
    expect(row.state).to.equal('degraded')

    dm.dispose()
  })

  it('unblock() returns DEVICE_NOT_FOUND for unknown id', function () {
    const clock = makeClock()
    const mainBus = new EventBus()

    const dm = new DeviceManager({
      logger: makeLogger(),
      mainBus,
      buses: { main: mainBus },
      clock,
      config: { devices: [] },
      mode: 'win11',
    })

    dm.start()

    const res = dm.unblock('nope')
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal('DEVICE_NOT_FOUND')

    dm.dispose()
  })
})
