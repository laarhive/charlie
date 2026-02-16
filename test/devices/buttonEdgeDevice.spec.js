// test/devices/buttonEdgeDevice.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import ButtonEdgeDevice from '../../src/devices/kinds/buttonEdge/buttonEdgeDevice.js'
import VirtualBinaryInput from '../../src/devices/protocols/virt/virtualBinaryInput.js'
import domainEventTypes from '../../src/domains/domainEventTypes.js'
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
  const domainBus = new EventBus({ busId: 'button' })

  const input = new VirtualBinaryInput(false)

  const protocolFactory = {
    makeBinaryInput: () => input,
  }

  const device = new ButtonEdgeDevice({
    logger: { error: () => {} },
    clock,
    domainBus,
    mainBus,
    device: {
      id: 'buttonVirt1',
      publishAs: 'button1',
      protocol: { type: 'virt', initial: false },
    },
    protocolFactory,
  })

  const trigger = () => {
    input.set(false)
    input.set(true)
    input.set(true)
    input.set(false)
  }

  return {
    clock,
    mainBus,
    domainBus,
    input,
    device,
    trigger,
  }
}

runDeviceConformanceTests({
  name: 'ButtonEdgeDevice',
  makeHarness,
})

describe('ButtonEdgeDevice – device-specific', function () {
  it('emits rising and falling edges on transitions (no duplicates while stable)', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()

    h.input.set(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.button.edge)
    expect(domainEvents[0].payload.edge).to.equal('rising')

    h.input.set(true)
    expect(domainEvents.length).to.equal(1)

    h.input.set(false)

    expect(domainEvents.length).to.equal(2)
    expect(domainEvents[1].type).to.equal(domainEventTypes.button.edge)
    expect(domainEvents[1].payload.edge).to.equal('falling')

    h.input.set(false)
    expect(domainEvents.length).to.equal(2)

    unsub()
    h.device.dispose()
  })

  it('inject { edge: "rising" } returns ok and emits rising edge', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()

    const res = h.device.inject({ edge: 'rising' })
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.button.edge)
    expect(domainEvents[0].payload.edge).to.equal('rising')

    unsub()
    h.device.dispose()
  })

  it('inject { edge: "falling" } returns ok and emits falling edge', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()

    const res = h.device.inject({ edge: 'falling' })
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.button.edge)
    expect(domainEvents[0].payload.edge).to.equal('falling')

    unsub()
    h.device.dispose()
  })

  it('inject works while manualBlocked and still emits domain events', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()
    h.device.block('test')

    const res = h.device.inject({ edge: 'rising' })
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.button.edge)
    expect(domainEvents[0].payload.edge).to.equal('rising')

    unsub()
    h.device.dispose()
  })

  it('inject works while degraded', function () {
    const clock = makeClock()
    const mainBus = new EventBus({ busId: 'main' })
    const domainBus = new EventBus({ busId: 'button' })

    const input = new VirtualBinaryInput(false)

    let onErrorRef = null
    const protocolFactory = {
      makeBinaryInput: (protocol, opts) => {
        void protocol
        onErrorRef = opts?.onError || null
        return input
      },
    }

    const device = new ButtonEdgeDevice({
      logger: { error: () => {} },
      clock,
      domainBus,
      mainBus,
      device: {
        id: 'buttonVirt1',
        publishAs: 'button1',
        protocol: { type: 'virt', initial: false },
      },
      protocolFactory,
    })

    const mainEvents = []
    const unsubMain = mainBus.subscribe((e) => mainEvents.push(e))

    const domainEvents = []
    const unsubDomain = domainBus.subscribe((e) => domainEvents.push(e))

    device.start()

    expect(typeof onErrorRef).to.equal('function')

    onErrorRef({ source: 'virt', message: 'simulated_error' })

    expect(
      mainEvents.some((e) => e.type === 'system:hardware' && e.payload?.state === 'degraded')
    ).to.equal(true)

    const res = device.inject({ edge: 'rising' })
    expect(res.ok).to.equal(true)

    expect(domainEvents.some((e) => e.type === domainEventTypes.button.edge && e.payload?.edge === 'rising')).to.equal(true)

    unsubMain()
    unsubDomain()
    device.dispose()
  })
})
