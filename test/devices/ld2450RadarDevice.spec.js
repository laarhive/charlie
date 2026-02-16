// test/devices/ld2450RadarDevice.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import Ld2450RadarDevice from '../../src/devices/kinds/ld2450Radar/ld2450RadarDevice.js'
import domainEventTypes from '../../src/domains/domainEventTypes.js'
import deviceErrorCodes from '../../src/devices/deviceErrorCodes.js'
import FakeUsbSerialDuplex from './shared/fakeUsbSerialDuplex.js'
import { runDeviceConformanceTests } from './shared/deviceConformance.js'
import { runUsbSerialDeviceConformanceTests } from './shared/usbSerialDeviceConformance.js'

const makeClock = function makeClock() {
  let now = 0

  return {
    nowMs: () => now,
    advance: (ms) => { now += ms },
  }
}

const makeHarness = function makeHarness({ serialPath = null, openResults } = {}) {
  const clock = makeClock()
  const mainBus = new EventBus({ busId: 'main' })
  const domainBus = new EventBus({ busId: 'presence' })

  const duplex = new FakeUsbSerialDuplex({ openResults })

  const protocolFactory = {
    makeUsbSerialDuplex: () => duplex,
  }

  const device = new Ld2450RadarDevice({
    logger: { error: () => {}, notice: () => {} },
    clock,
    domainBus,
    mainBus,
    device: {
      id: 'LD2450A',
      publishAs: 'LD2450A',
      domain: 'presence',
      kind: 'ld2450Radar',
      protocol: {
        type: 'serial',
        serialPath,
        dataTimeoutMs: 1500,
      },
      state: 'active',
    },
    protocolFactory,
  })

  return {
    clock,
    mainBus,
    domainBus,
    device,
    deviceId: 'LD2450A',

    duplex,
    emitData: (buf) => duplex.emitData(buf),
    emitStatus: (evt) => duplex.emitStatus(evt),

    expectsDomainEvents: true,
  }
}

runDeviceConformanceTests({
  name: 'Ld2450RadarDevice',
  makeHarness: () => makeHarness({ serialPath: null }),
})

runUsbSerialDeviceConformanceTests({
  name: 'Ld2450RadarDevice',
  makeHarness,
  activeRequiresData: true,
})

describe('Ld2450RadarDevice – device-specific', function () {
  it('inject accepts emitted payload shape (payload.frame) and re-emits', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    const payload = { frame: { ts: 123, targets: [] } }
    const first = h.device.inject(payload)
    expect(first.ok).to.equal(true)
    expect(domainEvents.length).to.equal(1)

    const emittedPayload = domainEvents[0].payload
    const second = h.device.inject(emittedPayload)

    expect(second.ok).to.equal(true)
    expect(domainEvents.length).to.equal(2)

    unsub()
    h.device.dispose()
  })

  it('inject works while manualBlocked and still emits domain events', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()
    h.device.block('test')

    const payload = { frame: { ts: 123, targets: [] } }
    const res = h.device.inject(payload)
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.presence.ld2450)

    unsub()
    h.device.dispose()
  })

  it('inject(undefined) returns INVALID_INJECT_PAYLOAD', function () {
    const h = makeHarness()

    const res = h.device.inject(undefined)
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal(deviceErrorCodes.invalidInjectPayload)

    h.device.dispose()
  })

  it('inject should accept emitted frame payload shape (inject–emit parity)', function () {
    const h = makeHarness()

    const res = h.device.inject({
      deviceId: 'LD2450A',
      publishAs: 'LD2450A',
      frame: { ts: 123, targets: [] },
    })

    expect(res.ok).to.equal(true)

    h.device.dispose()
  })
})
