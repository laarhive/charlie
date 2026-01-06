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

import FakeConversationAdapter from '../testing/fakeConversationAdapter.js'
import ConsoleLogger from '../logging/consoleLogger.js'

import CliParser from './cliParser.js'
import CliSimController from '../sim/cliSimController.js'

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

  // explicit relative path fallback
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

const makeContext = function makeContext({ logger, config }) {
  const clock = new Clock()
  clock.freeze()

  const bus = new EventBus()
  const scheduler = new TimeScheduler({ clock, bus })
  const conversation = new FakeConversationAdapter()
  const core = new CharlieCore({ clock, bus, scheduler, conversation, config })

  logger.info('context_created', { nowMs: clock.nowMs() })

  const dispose = function dispose() {
    core.dispose()
    scheduler.dispose()
  }

  return { clock, bus, scheduler, conversation, core, config, dispose }
}

const main = function main() {
  const args = parseArgs(process.argv)
  const logger = new Logger({ level: args.level })

  const defaultConfigFile = 'config/defaultConfig.json5'
  const initialConfigFile = args.config || defaultConfigFile

  let context = null

  try {
    const loaded = loadConfigFile(initialConfigFile)
    context = makeContext({ logger, config: loaded.config })
    logger.info('app_started', { configFile: loaded.fullPath, mode: args.mode })
  } catch (e) {
    logger.error('config_load_failed', { configFile: initialConfigFile, error: String(e?.message || e) })
    process.exit(1)
  }

  const getContext = function getContext() {
    return context
  }

  const setContext = function setContext({ config }) {
    const prev = context
    context = makeContext({ logger, config })

    if (prev?.dispose) {
      prev.dispose()
    }
  }

  const loadConfig = function loadConfig(filename) {
    return loadConfigFile(filename)
  }

  if (args.mode === 'sim') {
    const parser = new CliParser()

    const cli = new CliSimController({
      logger,
      parser,
      loadConfig,
      getContext,
      setContext,
    })

    cli.start()
    return
  }

  if (args.mode === 'hw') {
    logger.warn('hw_mode_not_implemented', {
      message: 'hw mode will attach gpio + sensorsController later. For now use --mode sim',
    })

    return
  }

  logger.error('invalid_mode', { mode: args.mode })
  process.exit(1)
}

main()
