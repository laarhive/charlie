// test/devices/shared/usbSerialDeviceConformance.js
import { expect } from 'chai'
import usbSerialErrorCodes from '../../../src/devices/protocols/usbSerial/usbSerialErrorCodes.js'

const flush = function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

const hwEventsFor = function hwEventsFor(mainEvents, deviceId) {
  return mainEvents.filter((e) => (
    e?.type === 'system:hardware' &&
    e?.payload?.deviceId === deviceId
  ))
}

const anyHw = function anyHw(mainEvents, deviceId, predicate) {
  const hw = hwEventsFor(mainEvents, deviceId)
  return hw.some((e) => predicate(e))
}

const lastHw = function lastHw(mainEvents, deviceId) {
  const hw = hwEventsFor(mainEvents, deviceId)
  return hw.length > 0 ? hw[hw.length - 1] : null
}

export const runUsbSerialDeviceConformanceTests = function runUsbSerialDeviceConformanceTests({
                                                                                                name,
                                                                                                makeHarness,
                                                                                                activeRequiresData = true,
                                                                                              }) {
  describe(`${name} – usb serial conformance`, function () {
    it('serialPath null => degraded usb_missing', async function () {
      const h = makeHarness({ serialPath: null })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()

      const id = h.deviceId || h.device.getId()
      const last = lastHw(mainEvents, id)

      expect(last).to.be.an('object')
      expect(last.payload.state).to.equal('degraded')
      expect(last.payload.detail?.error).to.equal('usb_missing')

      unsub()
      h.device.dispose()
    })

    it('open timeout => emits degraded serial_open_timeout (at least once)', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: false, error: usbSerialErrorCodes.serialOpenTimeout }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush() // allow async status emission from fake duplex

      const id = h.deviceId || h.device.getId()

      const sawOpenTimeout = anyHw(mainEvents, id, (e) => (
        e?.payload?.state === 'degraded' &&
        e?.payload?.detail?.error === 'serial_open_timeout'
      ))

      expect(sawOpenTimeout).to.equal(true)

      unsub()
      h.device.dispose()
    })

    it('open failed => emits degraded serial_open_failed (at least once)', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: false, error: usbSerialErrorCodes.serialOpenFailed }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush()

      const id = h.deviceId || h.device.getId()

      const sawOpenFailed = anyHw(mainEvents, id, (e) => (
        e?.payload?.state === 'degraded' &&
        e?.payload?.detail?.error === 'serial_open_failed'
      ))

      expect(sawOpenFailed).to.equal(true)

      unsub()
      h.device.dispose()
    })

    it('status open => link_ready (streaming) or active happened (non-streaming)', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: true }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush()

      if (typeof h.emitStatus === 'function') {
        h.emitStatus({ type: 'open' })
      } else if (h.duplex?.emitStatus) {
        h.duplex.emitStatus({ type: 'open' })
      }

      await flush()
      await flush()

      const id = h.deviceId || h.device.getId()
      const hw = hwEventsFor(mainEvents, id)
      expect(hw.length).to.be.greaterThan(0)

      if (activeRequiresData) {
        const last = hw[hw.length - 1]
        expect(last.payload.state).to.equal('degraded')
        expect(last.payload.detail?.error).to.equal('link_ready')
      } else {
        const anyActive = hw.some((e) => e?.payload?.state === 'active')
        expect(anyActive).to.equal(true)
      }

      unsub()
      h.device.dispose()
    })

    it('status close => degraded serial_closed', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: true }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush()

      if (typeof h.emitStatus === 'function') {
        h.emitStatus({ type: 'close' })
      } else if (h.duplex?.emitStatus) {
        h.duplex.emitStatus({ type: 'close' })
      }

      await flush()
      await flush()

      const id = h.deviceId || h.device.getId()
      const last = lastHw(mainEvents, id)

      expect(last).to.be.an('object')
      expect(last.payload.state).to.equal('degraded')
      expect(last.payload.detail?.error).to.equal('serial_closed')

      unsub()
      h.device.dispose()
    })

    it('status error => degraded serial_error', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: true }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush()

      if (typeof h.emitStatus === 'function') {
        h.emitStatus({ type: 'error', error: 'boom' })
      } else if (h.duplex?.emitStatus) {
        h.duplex.emitStatus({ type: 'error', error: 'boom' })
      }

      await flush()
      await flush()

      const id = h.deviceId || h.device.getId()
      const last = lastHw(mainEvents, id)

      expect(last).to.be.an('object')
      expect(last.payload.state).to.equal('degraded')
      expect(last.payload.detail?.error).to.equal('serial_error')

      unsub()
      h.device.dispose()
    })

    it('rebind(null) => usb_missing', async function () {
      const h = makeHarness({
        serialPath: 'FAKE',
        openResults: [{ ok: true }],
      })

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      await flush()
      await flush()

      expect(h.device.rebind).to.be.a('function')
      h.device.rebind({ serialPath: null })
      await flush()

      const id = h.deviceId || h.device.getId()
      const last = lastHw(mainEvents, id)

      expect(last).to.be.an('object')
      expect(last.payload.state).to.equal('degraded')
      expect(last.payload.detail?.error).to.equal('usb_missing')

      unsub()
      h.device.dispose()
    })
  })
}

export default runUsbSerialDeviceConformanceTests
