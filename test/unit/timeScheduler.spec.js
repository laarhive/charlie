// test/timeScheduler.spec.js
import { expect } from 'chai'
import Clock from '../../src/clock/clock.js'
import EventBus from '../../src/core/eventBus.js'
import TimeScheduler from '../../src/core/timeScheduler.js'
import flush from '../helpers/flush.js'

const collectEvents = function collectEvents(bus) {
  const events = []
  const unsubscribe = bus.subscribe((event) => {
    events.push(event)
  })

  return { events, unsubscribe }
}

describe('timeScheduler', function () {
  it('fires after advance reaches deadline', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setNowMs(100000)

    const bus = new EventBus({ busId: 'main' })
    const scheduler = new TimeScheduler({ clock, bus })
    const { events, unsubscribe } = collectEvents(bus)

    scheduler.scheduleIn({
      delayMs: 1000,
      type: 'time:test',
      payload: { a: 1 }
    })

    clock.advance(999)
    await flush()
    expect(events.filter((e) => e.type === 'time:test').length).to.equal(0)

    clock.advance(1)
    await flush()

    const fired = events.filter((e) => e.type === 'time:test')
    expect(fired.length).to.equal(1)
    expect(fired[0].source).to.equal('time')
    expect(fired[0].payload.a).to.equal(1)

    unsubscribe()
    scheduler.dispose()
  })

  it('cancel prevents firing', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setNowMs(200000)

    const bus = new EventBus({ busId: 'main' })
    const scheduler = new TimeScheduler({ clock, bus })
    const { events, unsubscribe } = collectEvents(bus)

    const token = scheduler.scheduleIn({
      delayMs: 1000,
      type: 'time:test',
      payload: { a: 2 }
    })

    scheduler.cancel(token)

    clock.advance(2000)
    await flush()

    const fired = events.filter((e) => e.type === 'time:test')
    expect(fired.length).to.equal(0)

    unsubscribe()
    scheduler.dispose()
  })

  it('setNowMs forward past deadlines triggers immediate firing', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setNowMs(300000)

    const bus = new EventBus({ busId: 'main' })
    const scheduler = new TimeScheduler({ clock, bus })
    const { events, unsubscribe } = collectEvents(bus)

    scheduler.scheduleAt({
      atMs: 301000,
      type: 'time:test',
      payload: { a: 3 }
    })

    clock.setNowMs(310000)
    await flush()

    const fired = events.filter((e) => e.type === 'time:test')
    expect(fired.length).to.equal(1)

    unsubscribe()
    scheduler.dispose()
  })

  it('multiple timers due at the same time all fire (order not important)', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setNowMs(400000)

    const bus = new EventBus({ busId: 'main' })
    const scheduler = new TimeScheduler({ clock, bus })
    const { events, unsubscribe } = collectEvents(bus)

    scheduler.scheduleIn({ delayMs: 1000, type: 'time:a', payload: {} })
    scheduler.scheduleIn({ delayMs: 1000, type: 'time:b', payload: {} })
    scheduler.scheduleIn({ delayMs: 1200, type: 'time:c', payload: {} })

    clock.advance(1000)
    await flush()

    const ab = events.map((e) => e.type).filter((t) => t === 'time:a' || t === 'time:b')
    expect(ab.length).to.equal(2)

    clock.advance(200)
    await flush()

    const c = events.filter((e) => e.type === 'time:c')
    expect(c.length).to.equal(1)

    unsubscribe()
    scheduler.dispose()
  })

  it('does not duplicate events after many clock changes', async function () {
    const clock = new Clock()
    clock.freeze()
    clock.setNowMs(500000)

    const bus = new EventBus({ busId: 'main' })
    const scheduler = new TimeScheduler({ clock, bus })
    const { events, unsubscribe } = collectEvents(bus)

    scheduler.scheduleIn({
      delayMs: 1000,
      type: 'time:test',
      payload: { a: 4 }
    })

    clock.advance(100)
    clock.advance(100)
    clock.advance(100)
    await flush()

    expect(events.filter((e) => e.type === 'time:test').length).to.equal(0)

    clock.advance(700)
    await flush()

    expect(events.filter((e) => e.type === 'time:test').length).to.equal(1)

    clock.advance(5000)
    await flush()

    expect(events.filter((e) => e.type === 'time:test').length).to.equal(1)

    unsubscribe()
    scheduler.dispose()
  })
})
