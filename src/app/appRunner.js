// src/app/appRunner.js
import fs from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

import Clock from '../clock/clock.js'
import EventBus from '../core/eventBus.js'
import TimeScheduler from '../core/timeScheduler.js'
import CharlieCore from '../core/charlieCore.js'
import Logger from '../logging/logger.js'
import BusTap from '../core/busTap.js'

import FakeConversationAdapter from '../testing/fakeConversationAdapter.js'

import CliParser from './cliParser.js'
import CliSimController from '../sim/cliSimController.js'

import BinaryPresenceController from '../domain/presence/binaryPresenceController.js'
import HitVibrationController from '../domain/vibration/hitVibrationController.js'
import EdgeButtonController from '../domain/button/edgeButtonController.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const parseArgs = function parseArgs(argv) {
  const args = {
    config: null,
    mode: 'sim',
    level: 'info',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]

    if (a === '--config' || a === '-c') {
      args.config = argv[i + 1] || null
      i += 1
      continue
    }

    if (a === '--mode' || a === '-m') {
      args.mode = argv[i + 1] || 'sim'
      i += 1
      continue
    }

    if (a === '--log-level') {
      args.level = argv[i + 1] || 'info'
      i += 1
      continue
    }
  }

  return args
}

const resolvePath = function resolvePath(filename) {
  if (!filename) {
    return null
  }

  if (path.isAbsolute(filename)) {
    return filename
  }

  const projectRoot = path.resolve(__dirname, '../..')
  const fromConfigDir = path.resolve(projectRoot, 'config', filename)

  if (fs.existsSync(fromConfigDir)) {
    return fromConfigDir
  }

  return path.resolve(projectRoot, filename)
}

const loadConfigFile = function loadConfigFile(filename) {
  const fullPath = resolvePath(filename)
  const raw = fs.readFileSync(fullPath, 'utf8')
  const ext = path.extname(fullPath).toLowerCase()

  if (ext === '.json5') {
    return { fullPath, config: JSON5.parse(raw) }
  }

  if (ext === '.json') {
    return { fullPath, config: JSON.parse(raw) }
  }

  throw new Error(`unsupported config extension: ${ext}`)
}

const makeBuses = function makeBuses() {
  return {
    main: new EventBus(),
    presence: new EventBus(),
    vibration: new EventBus(),
    button: new EventBus(),
  }
}

const makeControllers = function makeControllers({ logger, buses, clock, config }) {
  const sensors = Array.isArray(config?.sensors) ? config.sensors : []

  const presenceSensors = sensors.filter((s) => s?.role === 'presence')
  const vibrationSensors = sensors.filter((s) => s?.role === 'vibration')
  const buttonSensors = sensors.filter((s) => s?.role === 'button')

  const presenceController = new BinaryPresenceController({
    logger,
    presenceBus: buses.presence,
    mainBus: buses.main,
    clock,
    controllerId: 'presenceController',
    sensors: presenceSensors,
  })

  const vibrationController = new HitVibrationController({
    logger,
    vibrationBus: buses.vibration,
    mainBus: buses.main,
    clock,
    controllerId: 'vibrationController',
    sensors: vibrationSensors,
  })

  const pushButtonController = new EdgeButtonController({
    logger,
    buttonBus: buses.button,
    mainBus: buses.main,
    clock,
    controllerId: 'pushButtonController',
    sensors: buttonSensors,
  })

  return [presenceController, vibrationController, pushButtonController]
}

const makeTaps = function makeTaps({ logger, buses }) {
  return {
    main: new BusTap({ bus: buses.main, logger, name: 'main', enabled: false }),
    presence: new BusTap({ bus: buses.presence, logger, name: 'presence', enabled: false }),
    vibration: new BusTap({ bus: buses.vibration, logger, name: 'vibration', enabled: false }),
    button: new BusTap({ bus: buses.button, logger, name: 'button', enabled: false }),
  }
}

const makeContext = function makeContext({ logger, config }) {
  const clock = new Clock()
  clock.freeze()

  const buses = makeBuses()
  const taps = makeTaps({ logger, buses })

  const scheduler = new TimeScheduler({ clock, bus: buses.main })
  const conversation = new FakeConversationAdapter()

  const controllers = makeControllers({ logger, buses, clock, config })
  for (const c of controllers) {
    c.start()
  }

  const core = new CharlieCore({
    clock,
    bus: buses.main,
    scheduler,
    conversation,
    config,
  })

  logger.info('context_created', { nowMs: clock.nowMs() })

  const dispose = function dispose() {
    for (const t of Object.values(taps)) {
      t.dispose()
    }

    for (const c of controllers) {
      c.dispose()
    }

    core.dispose()
    scheduler.dispose()
  }

  return {
    clock,
    buses,
    taps,
    scheduler,
    conversation,
    controllers,
    core,
    config,
    dispose,
  }
}

/**
 * App runner for Charlie.
 *
 * Responsibilities:
 * - load config from file (JSON/JSON5)
 * - create buses (main + domain buses)
 * - start domain controllers (presence/vibration/button)
 * - start core + scheduler
 * - provide sim CLI entrypoint (hw will be added later)
 *
 * @example
 * const runner = new AppRunner()
 * runner.run(process.argv)
 */
export class AppRunner {
  #context
  #logger

  constructor() {
    this.#context = null
    this.#logger = null
  }

  /**
   * Runs the app with argv.
   *
   * @param {string[]} argv
   *
   * @example
   * runner.run(process.argv)
   */
  run(argv) {
    const args = parseArgs(argv)
    this.#logger = new Logger({ level: args.level })

    const defaultConfigFile = 'defaultConfig.json5'
    const initialConfigFile = args.config || defaultConfigFile

    try {
      const loaded = loadConfigFile(initialConfigFile)
      this.#context = makeContext({ logger: this.#logger, config: loaded.config })
      this.#logger.info('app_started', { configFile: loaded.fullPath, mode: args.mode })
    } catch (e) {
      this.#logger.error('config_load_failed', { configFile: initialConfigFile, error: String(e?.message || e) })
      process.exit(1)
    }

    const getContext = () => this.#context

    const setContext = ({ config }) => {
      const prev = this.#context
      this.#context = makeContext({ logger: this.#logger, config })

      if (prev?.dispose) {
        prev.dispose()
      }
    }

    const loadConfig = (filename) => loadConfigFile(filename)

    if (args.mode === 'sim') {
      const parser = new CliParser()

      const cli = new CliSimController({
        logger: this.#logger,
        parser,
        loadConfig,
        getContext,
        setContext,
      })

      cli.start()
      return
    }

    if (args.mode === 'hw') {
      this.#logger.warn('hw_mode_not_implemented', {
        message: 'hw mode will attach drivers later. For now use --mode sim',
      })

      return
    }

    this.#logger.error('invalid_mode', { mode: args.mode })
    process.exit(1)
  }
}

export default AppRunner

const main = function main() {
  const runner = new AppRunner()
  runner.run(process.argv)
}

main()
