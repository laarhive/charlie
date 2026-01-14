// src/app/appRunner.js
import process from 'node:process'

import Logger from '../logging/logger.js'
import formatError from './errorFormat.js'
import CliParser from '../cli/cliParser.js'
import CliController from '../cli/cliController.js'
import CliWsController from '../cli/cliWsController.js'

import parseArgs from './args.js'
import { loadConfigFile } from './configLoader.js'
import makeContext from './context.js'

export class AppRunner {
  #context
  #logger

  constructor() {
    this.#context = null
    this.#logger = null
  }

  run(argv) {
    const args = parseArgs(argv)
    this.#logger = new Logger({ level: args.level })

    if (args.cmd === 'cli') {
      this.#runWsCli(args)
      return
    }

    this.#runDaemon(args)
  }

  #runWsCli(args) {
    const parser = new CliParser()
    const wsUrl = `ws://${args.host}:${args.port}/ws`

    const cli = new CliWsController({
      logger: this.#logger,
      parser,
      wsUrl,
    })

    cli.start()
  }

  #runDaemon(args) {
    const defaultConfigFile = 'defaultConfig.json5'
    const initialConfigFile = args.config || defaultConfigFile

    try {
      const loaded = loadConfigFile(initialConfigFile)
      const config = loaded.config

      if (args.portProvided) {
        config.server ??= {}
        config.server.port = args.port
      }

      this.#context = makeContext({ logger: this.#logger, config, mode: args.mode })
      this.#logger.info('app_started', { configFile: loaded.fullPath, mode: args.mode, cli: args.cli })
    } catch (e) {
      const fe = formatError(e)

      this.#logger.error('config_load_failed', {
        configFile: initialConfigFile,
        error: fe.message,
        name: fe.name,
        stack: fe.stack,
        cause: fe.cause,
      })

      // Optional: immediate visibility during dev / CLI
      if (fe.stack) {
        console.error(fe.stack)
      }

      process.exit(1)
    }

    const getContext = () => this.#context

    const setContext = ({ config }) => {
      const prev = this.#context
      this.#context = makeContext({ logger: this.#logger, config, mode: args.mode })

      if (prev?.dispose) {
        prev.dispose()
      }
    }

    const loadConfig = (filename) => loadConfigFile(filename)

    if (args.cli) {
      const parser = new CliParser()

      const cli = new CliController({
        logger: this.#logger,
        parser,
        loadConfig,
        getContext,
        setContext,
        mode: args.mode,
      })

      cli.start()
      return
    }

    if (args.mode === 'hw') {
      this.#logger.notice('hw_mode_started', { note: 'CLI disabled. Use --cmd cli to attach remotely.' })
      return
    }

    if (args.mode === 'virt') {
      this.#logger.notice('virt_mode_started', { note: 'CLI disabled. Use --cmd cli to attach remotely.' })
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
