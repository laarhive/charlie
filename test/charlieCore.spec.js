// test/charlieCore.spec.js
import { expect } from 'chai'
import Clock from '../src/time/clock.js'
import EventBus from '../src/core/eventBus.js'
import TimeScheduler from '../src/core/timeScheduler.js'
import CharlieCore from '../src/core/charlieCore.js'
import FakeConversationAdapter from '../src/testing/fakeConversationAdapter.js'
import flush from './helpers/flush.js'

const makeConfig = function makeConfig() {
  return {
    timers: {
      armingDelayMs: 1000,
      exitConfirmMs: 800,
      conversationCooldownMs: 5000
    },
    rules: [
      {
        id: 'front-morning',
        priority: 10,
        conditions: { zone: 'front', weekday: [1,2,3,4,5], timeRanges: [{ start: '08:00', end: '12:00' }] },
        actions: { modePromptId: 'mode.front.morning', openerPromptId: 'opener.front.morning' }
      }
    ],
    promptText: {
      base: 'You are Charlie.',
      modes: { 'mode.front.morning': 'Front morning mode.' },
      openers: { 'opener.front.morning': 'Bună! Hai înăuntru 😄' }
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
    const config = makeConfig()

    const core = new CharlieCore({ clock, bus, scheduler, conversation: conv, config })

    bus.publish({ type: 'presence:enter', ts: clock.nowMs(), source: 'sim', payload: { zone: 'front' } })

    clock.advance(1000)
    await flush()

    const calls = conv.getCalls()
    expect(calls.starts.length).to.equal(1)

    core.dispose()
    scheduler.dispose()
  })
})
