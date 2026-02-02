// test/devices/ld2410RadarDevice.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import Ld2410RadarDevice from '../../src/devices/kinds/ld2410Radar/ld2410RadarDevice.js'
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
  const mainBus = new EventBus()
  const domainBus = new EventBus()

  const duplex = new FakeUsbSerialDuplex({ openResults })

  const protocolFactory = {
    makeUsbSerialDuplex: () => duplex,
  }

  const device = new Ld2410RadarDevice({
    logger: { error: () => {}, notice: () => {} },
    clock,
    domainBus,
    mainBus,
    device: {
      id: 'LD2410A',
      publishAs: 'LD2410A',
      domain: 'presence',
      kind: 'ld2410Radar',
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
    deviceId: 'LD2410A',

    duplex,
    emitData: (buf) => duplex.emitData(buf),
    emitStatus: (evt) => duplex.emitStatus(evt),

    expectsDomainEvents: true,
  }
}

runDeviceConformanceTests({
  name: 'Ld2410RadarDevice',
  makeHarness: () => makeHarness({ serialPath: null }),
})

runUsbSerialDeviceConformanceTests({
  name: 'Ld2410RadarDevice',
  makeHarness,
  activeRequiresData: true,
})

describe('Ld2410RadarDevice – device-specific', function () {
  it('inject(Buffer) returns ok and publishes base64+bytes payload', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04])

    const res = h.device.inject(buf)
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.presence.ld2410)

    expect(domainEvents[0].payload.deviceId).to.equal('LD2410A')
    expect(domainEvents[0].payload.publishAs).to.equal('LD2410A')
    expect(domainEvents[0].payload.bytes).to.equal(buf.length)
    expect(domainEvents[0].payload.base64).to.equal(buf.toString('base64'))

    unsub()
    h.device.dispose()
  })

  it('inject accepts emitted payload shape (base64/bytes) and re-emits', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    const buf = Buffer.from([0xaa, 0xbb, 0xcc])
    const first = h.device.inject(buf)
    expect(first.ok).to.equal(true)
    expect(domainEvents.length).to.equal(1)

    const emittedPayload = domainEvents[0].payload
    const second = h.device.inject(emittedPayload)

    expect(second.ok).to.equal(true)
    expect(domainEvents.length).to.equal(2)

    unsub()
    h.device.dispose()
  })

  it('inject({ base64 }) returns ok and publishes base64+bytes payload', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    const buf = Buffer.from([0x10, 0x20, 0x30])
    const b64 = buf.toString('base64')

    const res = h.device.inject({ base64: b64 })
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.presence.ld2410)
    expect(domainEvents[0].payload.bytes).to.equal(buf.length)
    expect(domainEvents[0].payload.base64).to.equal(b64)

    unsub()
    h.device.dispose()
  })

  it('inject works while manualBlocked and still emits domain events', function () {
    const h = makeHarness()

    const domainEvents = []
    const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

    h.device.start()
    h.device.block('test')

    const res = h.device.inject(Buffer.from([0x01]))
    expect(res.ok).to.equal(true)

    expect(domainEvents.length).to.equal(1)
    expect(domainEvents[0].type).to.equal(domainEventTypes.presence.ld2410)

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
      deviceId: 'LD2410A',
      publishAs: 'LD2410A',
      frame: { ts: 123, target: { state: 'stationary' } },
    })

    expect(res.ok).to.equal(true)

    h.device.dispose()
  })
})
