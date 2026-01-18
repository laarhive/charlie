// src/app/context.js
import Clock from '../clock/clock.js'
import TimeScheduler from '../core/timeScheduler.js'
import CharlieCore from '../core/charlieCore.js'
import FakeConversationAdapter from '../conversation/fakeConversationAdapter.js'

import makeBuses from './buses.js'
import makeTaps from './taps.js'
import makeDomainControllers, { startAll, disposeAll } from './domainControllers.js'
import GpioWatchdog from '../hw/gpio/gpioWatchdog.js'

import WebServer from './webServer.js'
import TaskerConversationAdapter from '../conversation/taskerConversationAdapter.js'
import ControlService from './controlService.js'

import DeviceManager from '../devices/deviceManager.js'

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

  // GPIO watchdog
  const gpioCfg = config?.gpio ?? {}
  const wdCfg = gpioCfg.watchdog ?? {}

  const gpioWatchdog = new GpioWatchdog({
    logger,
    bus: buses.main,
    clock,
    mode,
    chip: gpioCfg.chip || 'gpiochip0',
    outLine: wdCfg.outLine ?? 17,
    inLine: wdCfg.inLine ?? 27,
    toggleMs: wdCfg.toggleMs ?? 1000,
  })

  gpioWatchdog.start()

  const serverPort = Number(config?.server?.port ?? 8787)

  // Device manager owns device/driver lifecycle and publishes system:hardware
  const deviceManager = new DeviceManager({
    logger,
    mainBus: buses.main,
    buses,
    clock,
    config,
    mode,
  })

  deviceManager.start()

  const control = ControlService({
    buses,
    deviceManager,
    logger,
  })

  const webServer = new WebServer({
    logger,
    buses,
    getStatus: () => core.getSnapshot(),
    getConfig: () => config,
    control,
    port: serverPort,
  })

  webServer.start()

  logger.info('context_created', { nowMs: clock.nowMs(), mode, serverPort })

  const dispose = function dispose() {
    for (const t of Object.values(taps)) {
      t.dispose()
    }

    if (webServer) {
      webServer.dispose()
    }

    deviceManager.dispose()

    gpioWatchdog.dispose()
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

    deviceManager,
    webServer,
    control,

    dispose,
  }
}

export default makeContext
