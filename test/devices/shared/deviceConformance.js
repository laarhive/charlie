// test/devices/shared/deviceConformance.js
import { expect } from 'chai'

export const runDeviceConformanceTests = function runDeviceConformanceTests({
                                                                              name,
                                                                              makeHarness,
                                                                            }) {
  const hasTrigger = (h) => typeof h.trigger === 'function'
  const isInjectCapable = (h) => typeof h.device?.inject === 'function'
  const expectsDomainEvents = (h) => h.expectsDomainEvents !== false

  describe(`${name} – conformance`, function () {
    it('start() publishes at least one system:hardware event', function () {
      const h = makeHarness()

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()

      expect(
        mainEvents.some((e) => e?.type === 'system:hardware')
      ).to.equal(true)

      unsub()
      h.device.dispose()
    })

    it('system:hardware payload has required fields', function () {
      const h = makeHarness()

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()

      const hw = mainEvents.filter((e) => e?.type === 'system:hardware')
      expect(hw.length).to.be.greaterThan(0)

      const last = hw[hw.length - 1]
      expect(String(last.payload?.deviceId || '').length).to.be.greaterThan(0)
      expect(String(last.payload?.publishAs || '').length).to.be.greaterThan(0)
      expect(String(last.payload?.state || '').length).to.be.greaterThan(0)

      unsub()
      h.device.dispose()
    })

    it('start() is idempotent', function () {
      const h = makeHarness()

      h.device.start()
      h.device.start()

      h.device.dispose()
    })

    it('block() is idempotent', function () {
      const h = makeHarness()

      h.device.start()
      h.device.block('test')
      h.device.block('test2')

      h.device.dispose()
    })

    it('unblock() is idempotent', function () {
      const h = makeHarness()

      h.device.start()
      h.device.block('test')
      h.device.unblock()
      h.device.unblock()

      h.device.dispose()
    })

    it('block() suppresses domain events (if device emits domain events)', function () {
      const h = makeHarness()
      if (!expectsDomainEvents(h)) this.skip()
      if (!hasTrigger(h)) this.skip()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')

      h.trigger()

      expect(domainEvents.length).to.equal(0)

      unsub()
      h.device.dispose()
    })

    it('unblock() allows domain events again (if device emits domain events)', function () {
      const h = makeHarness()
      if (!expectsDomainEvents(h)) this.skip()
      if (!hasTrigger(h)) this.skip()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')

      h.trigger()
      expect(domainEvents.length).to.equal(0)

      h.device.unblock()

      h.trigger()
      expect(domainEvents.length).to.be.greaterThan(0)

      unsub()
      h.device.dispose()
    })

    it('dispose() does not publish manualBlocked', function () {
      const h = makeHarness()

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()
      h.device.dispose()

      const manualBlocked = mainEvents.some(
        (e) => e?.type === 'system:hardware' && e?.payload?.state === 'manualBlocked'
      )

      expect(manualBlocked).to.equal(false)

      unsub()
    })

    it('no domain events after dispose() (if device emits domain events)', function () {
      const h = makeHarness()
      if (!expectsDomainEvents(h)) this.skip()
      if (!hasTrigger(h)) this.skip()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()

      h.trigger()
      expect(domainEvents.length).to.be.greaterThan(0)

      h.device.dispose()

      const before = domainEvents.length

      h.trigger()
      expect(domainEvents.length).to.equal(before)

      unsub()
    })

    it('dispose() is idempotent', function () {
      const h = makeHarness()

      h.device.start()
      h.device.dispose()
      h.device.dispose()
    })

    it('inject(undefined) returns INVALID_INJECT_PAYLOAD (before start) for inject-capable devices', function () {
      const h = makeHarness()

      if (typeof h.device?.inject !== 'function') {
        h.device.dispose()
        return
      }

      const res = h.device.inject(undefined)

      expect(res).to.be.an('object')
      expect(res.ok).to.equal(false)
      expect(res.error).to.equal('INVALID_INJECT_PAYLOAD')

      h.device.dispose()
    })

    it('inject(undefined) returns INVALID_INJECT_PAYLOAD (after start) for inject-capable devices', function () {
      const h = makeHarness()

      if (typeof h.device?.inject !== 'function') {
        h.device.dispose()
        return
      }

      h.device.start()

      const res = h.device.inject(undefined)

      expect(res).to.be.an('object')
      expect(res.ok).to.equal(false)
      expect(res.error).to.equal('INVALID_INJECT_PAYLOAD')

      h.device.dispose()
    })
  })
}

export default runDeviceConformanceTests
