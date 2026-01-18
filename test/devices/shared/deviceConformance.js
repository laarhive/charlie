// test/devices/shared/deviceConformance.js
import { expect } from 'chai'

export const runDeviceConformanceTests = function runDeviceConformanceTests({
                                                                              name,
                                                                              makeHarness,
                                                                            }) {
  const hasTrigger = (h) => typeof h.trigger === 'function'
  const isInjectCapable = (h) => typeof h.device?.inject === 'function'

  describe(`${name} – conformance`, function () {
    it('start() publishes system:hardware active', function () {
      const h = makeHarness()

      const mainEvents = []
      const unsub = h.mainBus.subscribe((e) => mainEvents.push(e))

      h.device.start()

      expect(
        mainEvents.some((e) => e?.type === 'system:hardware' && e?.payload?.state === 'active')
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

      const domainEvents = []
      const unsubDomain = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.start()

      if (hasTrigger(h)) {
        h.trigger()

        expect(domainEvents.length).to.be.greaterThan(0)

        const before = domainEvents.length
        h.trigger()

        expect(domainEvents.length).to.be.greaterThan(before)
      }

      unsubDomain()
      h.device.dispose()
    })

    it('block() suppresses domain events', function () {
      const h = makeHarness()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')

      if (hasTrigger(h)) {
        h.trigger()
      }

      expect(domainEvents.length).to.equal(0)

      unsub()
      h.device.dispose()
    })

    it('block() is idempotent', function () {
      const h = makeHarness()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')
      h.device.block('test2')

      if (hasTrigger(h)) {
        h.trigger()
      }

      expect(domainEvents.length).to.equal(0)

      unsub()
      h.device.dispose()
    })

    it('unblock() allows domain events again and is idempotent', function () {
      const h = makeHarness()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')

      if (hasTrigger(h)) {
        h.trigger()
      }

      expect(domainEvents.length).to.equal(0)

      h.device.unblock()
      h.device.unblock()

      if (hasTrigger(h)) {
        h.trigger()
      }

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

    it('no domain events after dispose()', function () {
      const h = makeHarness()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()

      if (hasTrigger(h)) {
        h.trigger()
        expect(domainEvents.length).to.be.greaterThan(0)
      }

      h.device.dispose()

      const before = domainEvents.length

      if (hasTrigger(h)) {
        h.trigger()
      }

      expect(domainEvents.length).to.equal(before)

      unsub()
    })

    it('dispose() is idempotent', function () {
      const h = makeHarness()

      h.device.start()
      h.device.dispose()
      h.device.dispose()
    })

    it('inject(undefined) returns NOT_SUPPORTED for inject-capable devices', function () {
      const h = makeHarness()

      if (!isInjectCapable(h)) {
        h.device.dispose()
        return
      }

      h.device.start()

      const res = h.device.inject(undefined)

      expect(res.ok).to.equal(false)
      expect(res.error).to.equal('NOT_SUPPORTED')

      h.device.dispose()
    })

    it('inject does not crash even when called before start()', function () {
      const h = makeHarness()

      if (!isInjectCapable(h)) {
        h.device.dispose()
        return
      }

      const res = h.device.inject(undefined)

      expect(res.ok).to.equal(false)
      expect(res.error).to.equal('NOT_SUPPORTED')

      h.device.dispose()
    })

    it('blocked state remains effective across repeated start() calls', function () {
      const h = makeHarness()

      const domainEvents = []
      const unsub = h.domainBus.subscribe((e) => domainEvents.push(e))

      h.device.start()
      h.device.block('test')

      h.device.start()

      if (hasTrigger(h)) {
        h.trigger()
      }

      expect(domainEvents.length).to.equal(0)

      unsub()
      h.device.dispose()
    })
  })
}

export default runDeviceConformanceTests
