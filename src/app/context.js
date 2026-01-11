// src/app/context.js
import Clock from '../clock/clock.js'
import TimeScheduler from '../core/timeScheduler.js'
import CharlieCore from '../core/charlieCore.js'
import FakeConversationAdapter from '../conversation/fakeConversationAdapter.js'

import makeBuses from './buses.js'
import makeTaps from './taps.js'
import makeDomainControllers, { startAll, disposeAll } from './domainControllers.js'
import makeHwDrivers, { disposeSignals } from './hwDrivers.js'

import WebServer from './webServer.js'
import TaskerConversationAdapter from '../conversation/taskerConversationAdapter.js'

/**
 * Builds the full runtime context (buses, taps, controllers, core, scheduler, web server).
 *
 * @example
 * const ctx = makeContext({ logger, config, mode: 'virt' })
 * ctx.dispose()
 */
export const makeContext = function makeContext({ logger, config, mode }) {
  const clock = new Clock()
  clock.freeze()

  const buses = makeBuses()
  const taps = makeTaps({ logger, buses })

  const scheduler = new TimeScheduler({ clock, bus: buses.main })

  const conversation = (() => {
    const baseUrl = String(config?.tasker?.baseUrl || '').trim()
    if (baseUrl) {
      logger.notice('conversation_adapter_tasker', { baseUrl })
      return new TaskerConversationAdapter({ logger, taskerBus: buses.tasker, config })
    }

    logger.notice('conversation_adapter_fake', {})
    return new FakeConversationAdapter()
  })()

  const domainControllers = makeDomainControllers({ logger, buses, clock, config })
  startAll(domainControllers)

  const core = new CharlieCore({
    clock,
    bus: buses.main,
    scheduler,
    conversation,
    config,
  })

  const serverPort = Number(config?.server?.port ?? 8787)

  const webServer = new WebServer({
    logger,
    buses,
    getStatus: () => core.getSnapshot(),
    getConfig: () => config,
    port: serverPort,
  })

  webServer.start()

  const hw = makeHwDrivers({ logger, buses, clock, config, mode })

  if (mode === 'hw') {
    logger.notice('hw_mode_starting_drivers', { driverCount: hw.drivers.length })
    startAll(hw.drivers)
  }

  if (mode === 'virt') {
    logger.notice('virt_mode_virtual_signals', {
      note: 'Virtual drivers/signals enabled. Use virt set to drive inputs.',
      driverCount: hw.drivers.length,
    })

    startAll(hw.drivers)
  }

  logger.info('context_created', { nowMs: clock.nowMs(), mode, serverPort })

  const dispose = function dispose() {
    for (const t of Object.values(taps)) {
      t.dispose()
    }

    disposeAll(hw.drivers)
    disposeSignals(hw.signals)

    if (webServer) {
      webServer.dispose()
    }

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
    webServer,
    dispose,
  }
}

export default makeContext
