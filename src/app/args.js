// src/app/args.js

/**
 * Parses CLI arguments for the app runner.
 *
 * @example
 * const args = parseArgs(process.argv)
 */
export const parseArgs = function parseArgs(argv) {
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

export default parseArgs
