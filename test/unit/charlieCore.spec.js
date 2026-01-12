// test/charlieCore.spec.js
import { expect } from 'chai'
import Clock from '../../src/clock/clock.js'
import EventBus from '../../src/core/eventBus.js'
import TimeScheduler from '../../src/core/timeScheduler.js'
import CharlieCore from '../../src/core/charlieCore.js'
import FakeConversationAdapter from '../../src/conversation/fakeConversationAdapter.js'
import flush from '../helpers/flush.js'

const makeConfig = function makeConfig({ armingDelayMs = 1000, exitConfirmMs = 800, cooldownMs = 2000 } = {}) {
  return {
    timers: {
      armingDelayMs,
      exitConfirmMs,
      conversationCooldownMs: cooldownMs
    },
    rules: [
      {
        id: 'front-morning',
        priority: 10,
        conditions: { zone: 'front', weekday: [1,2,3,4,5,6,7], timeRanges: [{ start: '00:00', end: '24:00' }] },
        actions: { modePromptId: 'mode.front.any', openerPromptId: 'opener.front.any' }
      }
    ],
    promptText: {
      base: 'You are Charlie.',
      modes: { 'mode.front.any': 'Mode.' },
      openers: { 'opener.front.any': 'Opener instruction.' }
    }
  }
}

describe('CharlieCore + TimeScheduler', function () {
  it('starts after arming delay via time event', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setLocalDateTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })

    const bus = new EventBus()
    const scheduler = new TimeScheduler({ clock, bus })
    const conv = new FakeConversationAdapter()
    const config = makeConfig({ armingDelayMs: 1000, exitConfirmMs: 800, cooldownMs: 5000 })

    const core = new CharlieCore({ clock, bus, scheduler, conversation: conv, config })

    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })

    clock.advance(1000)
    await flush()

    const calls = conv.getCalls()
    expect(calls.starts.length).to.equal(1)

    core.dispose()
    scheduler.dispose()
  })

  it('stops after exitConfirm when presence becomes NONE', async function () {
    const config = makeConfig({ armingDelayMs: 500, exitConfirmMs: 400, cooldownMs: 1000 })

    const clock = new Clock()
    clock.freeze()
    clock.setLocalDateTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })

    const bus = new EventBus()
    const scheduler = new TimeScheduler({ clock, bus })
    const conv = new FakeConversationAdapter()
    const core = new CharlieCore({ clock, bus, scheduler, conversation: conv, config })

    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(500)
    await flush()

    expect(conv.getCalls().starts.length).to.equal(1)

    bus.publish({ type: 'presence:exit', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(400)
    await flush()

    const calls = conv.getCalls()
    expect(calls.stops.length).to.equal(1)

    const snap = core.getSnapshot()
    expect(snap.state).to.equal('COOLDOWN')

    core.dispose()
    scheduler.dispose()
  })

  it('cancels exitConfirm if presence returns before expiry', async function () {
    const config = makeConfig({ armingDelayMs: 500, exitConfirmMs: 400, cooldownMs: 1000 })

    const clock = new Clock()
    clock.freeze()
    clock.setLocalDateTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })

    const bus = new EventBus()
    const scheduler = new TimeScheduler({ clock, bus })
    const conv = new FakeConversationAdapter()
    const core = new CharlieCore({ clock, bus, scheduler, conversation: conv, config })

    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(500)
    await flush()

    expect(conv.getCalls().starts.length).to.equal(1)

    bus.publish({ type: 'presence:exit', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(200)
    await flush()

    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(250)
    await flush()

    const calls = conv.getCalls()
    expect(calls.stops.length).to.equal(0)

    const snap = core.getSnapshot()
    expect(snap.state).to.equal('ACTIVE')

    core.dispose()
    scheduler.dispose()
  })

  it('cooldown blocks retrigger until cooldown expires', async function () {
    const config = makeConfig({ armingDelayMs: 500, exitConfirmMs: 300, cooldownMs: 800 })

    const clock = new Clock()
    clock.freeze()
    clock.setLocalDateTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 0 })

    const bus = new EventBus()
    const scheduler = new TimeScheduler({ clock, bus })
    const conv = new FakeConversationAdapter()
    const core = new CharlieCore({ clock, bus, scheduler, conversation: conv, config })

    // Start first session
    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(500)
    await flush()

    expect(conv.getCalls().starts.length).to.equal(1)

    // Leave -> stop -> cooldown
    bus.publish({ type: 'presence:exit', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(300)
    await flush()

    expect(conv.getCalls().stops.length).to.equal(1)
    expect(core.getSnapshot().state).to.equal('COOLDOWN')

    // During cooldown, try to retrigger
    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(500)
    await flush()

    expect(conv.getCalls().starts.length).to.equal(1)

    // Finish cooldown
    clock.advance(800)
    await flush()

    expect(core.getSnapshot().state).to.equal('IDLE')

    // Trigger again after cooldown
    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })
    clock.advance(500)
    await flush()

    expect(conv.getCalls().starts.length).to.equal(2)

    core.dispose()
    scheduler.dispose()
  })
})
