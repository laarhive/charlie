// src/app/appRunner.js
import process from 'node:process'

import Logger from '../logging/logger.js'
import CliParser from './cliParser.js'
import CliSimController from '../sim/cliSimController.js'

import parseArgs from './args.js'
import { loadConfigFile } from './configLoader.js'
import makeContext from './context.js'

/**
 * App runner for Charlie.
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
      this.#context = makeContext({ logger: this.#logger, config: loaded.config, mode: args.mode })
      this.#logger.info('app_started', { configFile: loaded.fullPath, mode: args.mode })
    } catch (e) {
      this.#logger.error('config_load_failed', { configFile: initialConfigFile, error: String(e?.message || e) })
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
      this.#logger.notice('hw_mode_started', {
        note: 'No CLI in hw mode. Use taps/logging. Later: real GPIO/serial drivers.',
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
