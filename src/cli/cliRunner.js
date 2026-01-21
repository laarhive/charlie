// src/cli/cliRunner.js
import process from 'node:process'

import Logger from '../logging/logger.js'
import CliParser from './cliParser.js'
import CliWsController from './cliWsController.js'
import parseArgs from '../app/args.js'

export class CliRunner {
  #logger

  constructor() {
    this.#logger = null
  }

  async run(argv) {
    const args = parseArgs(argv)
    this.#logger = new Logger({ level: args.level })

    const host = String(args.host || '127.0.0.1').trim()
    const port = Number(args.port || 8787)

    const wsUrl = `ws://${host}:${port}/ws`

    const parser = new CliParser()

    const cli = new CliWsController({
      logger: this.#logger,
      parser,
      wsUrl,
    })

    await cli.start()
  }
}

export default CliRunner

const main = async function main() {
  const runner = new CliRunner()
  await runner.run(process.argv)
}

main()
