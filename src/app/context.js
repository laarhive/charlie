// src/app/context.js
import Clock from '../clock/clock.js'
import TimeScheduler from '../core/timeScheduler.js'
import CharlieCore from '../core/charlieCore.js'
import FakeConversationAdapter from '../testing/fakeConversationAdapter.js'

import makeBuses from './buses.js'
import makeTaps from './taps.js'
import makeDomainControllers, { startAll, disposeAll } from './domainControllers.js'
import makeHwDrivers, { disposeSignals } from './hwDrivers.js'

/**
 * Builds the full runtime context (buses, taps, controllers, core, scheduler).
 *
 * @example
 * const ctx = makeContext({ logger, config, mode: 'sim' })
 * ctx.dispose()
 */
export const makeContext = function makeContext({ logger, config, mode }) {
  const clock = new Clock()
  clock.freeze()

  const buses = makeBuses()
  const taps = makeTaps({ logger, buses })

  const scheduler = new TimeScheduler({ clock, bus: buses.main })
  const conversation = new FakeConversationAdapter()

  const domainControllers = makeDomainControllers({ logger, buses, clock, config })
  startAll(domainControllers)

  const core = new CharlieCore({
    clock,
    bus: buses.main,
    scheduler,
    conversation,
    config,
  })

  const hw = makeHwDrivers({ logger, buses, clock, config })

  if (mode === 'hw') {
    logger.notice('hw_mode_virtual_signals', {
      note: 'Using VirtualBinarySignal for ld2410 inputs. Replace with GPIO on RPi.',
      ld2410Count: hw.drivers.length,
    })

    startAll(hw.drivers)
  }

  logger.info('context_created', { nowMs: clock.nowMs(), mode })

  const dispose = function dispose() {
    for (const t of Object.values(taps)) {
      t.dispose()
    }

    disposeAll(hw.drivers)
    disposeSignals(hw.signals)

    core.dispose()
    scheduler.dispose()

    disposeAll(domainControllers)
  }

  return {
    clock,
    buses,
    taps,
    scheduler,
    conversation,
    domainControllers,
    core,
    config,
    hw,
    dispose,
  }
}

export default makeContext
