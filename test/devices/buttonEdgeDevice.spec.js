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
  const mainBus = new EventBus()
  const domainBus = new EventBus()

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
  it('emits only on rising transitions', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()

    h.input.set(false)
    expect(domainEvents.length).to.equal(0)

    h.clock.advance(1)
    h.input.set(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.button.edge)

    h.clock.advance(1)
    h.input.set(true)
    expect(domainEvents.length).to.equal(1)

    h.clock.advance(1)
    h.input.set(false)
    expect(domainEvents.length).to.equal(1)

    unsub()
    h.device.dispose()
  })

  it('inject press returns ok', function () {
    const h = makeHarness()

    h.device.start()

    const res = h.device.inject('press 10')
    expect(res.ok).to.equal(true)

    h.device.dispose()
  })
})
