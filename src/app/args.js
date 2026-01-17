// src/app/args.js
export const parseArgs = function parseArgs(argv) {
  const args = {
    // process role
    run: 'daemon', // 'daemon' | 'cli'

    // runtime config
    config: null,
    mode: null, // REQUIRED for daemon

    // logging
    level: 'info',

    // local CLI attachment
    interactive: false,

    // ws client / server
    host: '127.0.0.1',
    port: 8787,
    portProvided: false,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]

    if (a === '--run') {
      const v = String(argv[i + 1] || '').trim()
      i += 1

      if (v === 'daemon' || v === 'cli') {
        args.run = v
      }

      continue
    }

    if (a === '--host') {
      args.host = String(argv[i + 1] || '127.0.0.1').trim()
      i += 1
      continue
    }

    if (a === '--port') {
      const n = Number(argv[i + 1] || 8787)
      i += 1

      if (!Number.isNaN(n) && n > 0) {
        args.port = n
        args.portProvided = true
      }

      continue
    }

    if (a === '--config' || a === '-c') {
      args.config = argv[i + 1] || null
      i += 1
      continue
    }

    if (a === '--mode' || a === '-m') {
      const v = String(argv[i + 1] || '').trim()
      i += 1

      if (v) {
        args.mode = v
      }

      continue
    }

    if (a === '--log-level') {
      args.level = argv[i + 1] || 'info'
      i += 1
      continue
    }

    if (a === '--interactive') {
      args.interactive = true
      continue
    }
  }

  return args
}

export default parseArgs
