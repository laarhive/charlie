// test/devices/ws2812LedDevice.spec.js
import { expect } from 'chai'
import EventBus from '../../src/core/eventBus.js'
import Ws2812LedDevice from '../../src/devices/kinds/ws2812Led/ws2812LedDevice.js'
import deviceErrorCodes from '../../src/devices/deviceErrorCodes.js'
import usbSerialErrorCodes from '../../src/devices/protocols/usbSerial/usbSerialErrorCodes.js'
import FakeUsbSerialDuplex from './shared/fakeUsbSerialDuplex.js'
import { runDeviceConformanceTests } from './shared/deviceConformance.js'
import { runUsbSerialDeviceConformanceTests } from './shared/usbSerialDeviceConformance.js'

const flush = function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

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

  const device = new Ws2812LedDevice({
    logger: { error: () => {}, notice: () => {}, warning: () => {} },
    clock,
    domainBus,
    mainBus,
    device: {
      id: 'statusLed1',
      publishAs: 'statusLed',
      domain: 'led',
      kind: 'ws2812Led',
      protocol: {
        type: 'serial',
        serialPath,
        baudRate: 115200,
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
    deviceId: 'statusLed1',

    duplex,
    emitStatus: (evt) => duplex.emitStatus(evt),

    expectsDomainEvents: true,
  }
}

runDeviceConformanceTests({
  name: 'Ws2812LedDevice',
  makeHarness: () => makeHarness({ serialPath: null }),
})

runUsbSerialDeviceConformanceTests({
  name: 'Ws2812LedDevice',
  makeHarness,
  activeRequiresData: false,
})

describe('Ws2812LedDevice – device-specific', function () {
  it('inject(undefined) returns INVALID_INJECT_PAYLOAD', function () {
    const h = makeHarness()

    const res = h.device.inject(undefined)
    expect(res.ok).to.equal(false)
    expect(res.error).to.equal(deviceErrorCodes.invalidInjectPayload)

    h.device.dispose()
  })

  it('inject({ rgb }) writes encoded command when active', async function () {
    const h = makeHarness({
      serialPath: 'FAKE',
      openResults: [{ ok: true }],
    })

    h.device.start()
    await flush()

    const res = h.device.inject({ rgb: [1, 2, 3] })
    expect(res.ok).to.equal(true)

    // inject schedules async write (promise)
    await flush()

    const writes = h.duplex.getWrites()
    expect(writes.length).to.be.greaterThan(0)

    const last = writes[writes.length - 1].toString('utf8')
    expect(last).to.equal('1,2,3\n')

    h.device.dispose()
  })

  it('recovery re-applies last rgb after open timeout', async function () {
    const h = makeHarness({
      serialPath: 'FAKE',
      openResults: [{ ok: false, error: usbSerialErrorCodes.serialOpenTimeout }],
    })

    const mainEvents = []
    const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

    h.device.start()
    await flush()

    // Set a desired rgb while degraded; device will simulate and store lastRgb.
    const r1 = h.device.inject({ rgb: [9, 8, 7] })
    expect(r1.ok).to.equal(true)

    // No writes yet because link isn't open
    expect(h.duplex.getWrites().length).to.equal(0)

    // Now recover link
    h.emitStatus({ type: 'open' })
    await flush()
    await flush()

    const writes = h.duplex.getWrites()
    expect(writes.length).to.be.greaterThan(0)

    const last = writes[writes.length - 1].toString('utf8')
    expect(last).to.equal('9,8,7\n')

    // Also ensure device reported degraded(open_timeout) at some point
    const hw = mainEvents.filter((e) => e?.type === 'system:hardware' && e?.payload?.deviceId === 'statusLed1')
    expect(hw.length).to.be.greaterThan(0)

    const anyOpenTimeout = hw.some((e) => e?.payload?.state === 'degraded' && e?.payload?.detail?.error === 'serial_open_timeout')
    expect(anyOpenTimeout).to.equal(true)

    unsub()
    h.device.dispose()
  })

  it('status close marks degraded serial_closed', async function () {
    const h = makeHarness({
      serialPath: 'FAKE',
      openResults: [{ ok: true }],
    })

    const mainEvents = []
    const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

    h.device.start()
    await flush()

    h.emitStatus({ type: 'close' })
    await flush()

    const hw = mainEvents.filter((e) => e?.type === 'system:hardware' && e?.payload?.deviceId === 'statusLed1')
    expect(hw.length).to.be.greaterThan(0)

    const last = hw[hw.length - 1]
    expect(last.payload.state).to.equal('degraded')
    expect(last.payload.detail?.error).to.equal('serial_closed')

    unsub()
    h.device.dispose()
  })
})
