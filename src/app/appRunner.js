// src/app/appRunner.js
import process from 'node:process'

import Logger from '../logging/logger.js'
import formatError from '../core/errorFormat.js'
import CliParser from '../cli/cliParser.js'
import CliController from '../cli/cliController.js'

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

    if (!args.mode) {
      this.#logger.error('missing_required_arg', {
        arg: '--mode',
        example: '--mode rpi4',
      })

      process.exit(1)
    }

    this.#runDaemon(args)
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
      this.#logger.info('app_started', { configFile: loaded.fullPath, mode: args.mode, interactive: args.interactive })
    } catch (e) {
      const fe = formatError(e)

      this.#logger.error('config_load_failed', {
        configFile: initialConfigFile,
        error: fe.message,
        name: fe.name,
        stack: fe.stack,
        cause: fe.cause,
      })

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

    if (args.interactive) {
      const parser = new CliParser()

      const cli = new CliController({
        logger: this.#logger,
        parser,
        loadConfig,
        getContext,
        setContext,
      })

      cli.start()
      return
    }

    this.#logger.notice('daemon_started', {
      note: 'Interactive CLI disabled. Start with --interactive to enable local CLI.',
      mode: args.mode,
    })
  }
}

export default AppRunner

const main = function main() {
  const runner = new AppRunner()
  runner.run(process.argv)
}

main()
