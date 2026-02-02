import { expect } from 'chai'
import eventTypes from '../../../src/core/eventTypes.js'

export const runDeviceManagerUnitConformanceTests = function runDeviceManagerUnitConformanceTests({
                                                                                                    makeHarness,
                                                                                                  }) {
  const find = (dm, id) => dm.list().devices.find((d) => d.id === id)

  it('start() respects config state manualBlocked (not started + state manualBlocked)', function () {
    const h = makeHarness()
    h.dm.start()

    const row = find(h.dm, h.expect.manualBlockedId)
    expect(row).to.exist
    expect(row.started).to.equal(false)
    expect(row.state).to.equal('manualBlocked')

    h.dm.dispose()
  })

  it('block/unblock/inject return DEVICE_NOT_FOUND for unknown ids', function () {
    const h = makeHarness()
    h.dm.start()

    const b = h.dm.block('nope', 'test')
    expect(b.ok).to.equal(false)
    expect(b.error).to.equal('DEVICE_NOT_FOUND')

    const u = h.dm.unblock('nope', 'test')
    expect(u.ok).to.equal(false)
    expect(u.error).to.equal('DEVICE_NOT_FOUND')

    const i = h.dm.inject('nope', 'press 1')
    expect(i.ok).to.equal(false)
    expect(i.error).to.equal('DEVICE_NOT_FOUND')

    h.dm.dispose()
  })

  it('tracks state updates from system:hardware events on main bus', function () {
    const h = makeHarness()
    h.dm.start()

    const before = find(h.dm, h.expect.manualBlockedId)
    expect(before.state).to.equal('manualBlocked')

    h.mainBus.publish({
      type: eventTypes.system.hardware,
      ts: h.clock.nowMs(),
      source: 'test',
      payload: {
        deviceId: h.expect.manualBlockedId,
        publishAs: 'x',
        state: 'active',
        detail: {},
      },
    })

    const after = find(h.dm, h.expect.manualBlockedId)
    expect(after.state).to.equal('active')

    h.dm.dispose()
  })

  it('unblock() is idempotent when already active (based on tracked state)', function () {
    const h = makeHarness()
    h.dm.start()

    h.mainBus.publish({
      type: eventTypes.system.hardware,
      ts: h.clock.nowMs(),
      source: 'test',
      payload: {
        deviceId: h.expect.manualBlockedId,
        publishAs: 'x',
        state: 'active',
        detail: {},
      },
    })

    const res = h.dm.unblock(h.expect.manualBlockedId, 'test')
    expect(res.ok).to.equal(true)
    expect(res.note).to.equal('already_active')

    h.dm.dispose()
  })

  it('block() updates state to manualBlocked even if instance is not started', function () {
    const h = makeHarness()
    h.dm.start()

    const res = h.dm.block(h.expect.manualBlockedId, 'test')
    expect(res.ok).to.equal(true)

    const row = find(h.dm, h.expect.manualBlockedId)
    expect(row.state).to.equal('manualBlocked')

    h.dm.dispose()
  })

  it('bad kind causes create failure and state becomes degraded', function () {
    const h = makeHarness()
    h.dm.start()

    const row = find(h.dm, h.expect.badKindId)
    expect(row).to.exist
    expect(row.started).to.equal(false)
    expect(row.state).to.equal('degraded')

    h.dm.dispose()
  })

  it('dispose() is idempotent', function () {
    const h = makeHarness()
    h.dm.start()
    h.dm.dispose()
    h.dm.dispose()
  })
}

export default runDeviceManagerUnitConformanceTests
