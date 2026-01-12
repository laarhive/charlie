// src/app/args.js
export const parseArgs = function parseArgs(argv) {
  const args = {
    cmd: 'daemon',
    config: null,
    mode: 'virt',
    level: 'info',
    cli: false,

    host: '127.0.0.1',
    port: 8787,
    portProvided: false,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]

    if (a === '--cmd') {
      const v = String(argv[i + 1] || '').trim()
      i += 1

      if (v === 'daemon' || v === 'cli') {
        args.cmd = v
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
      const v = argv[i + 1] || 'virt'
      i += 1

      if (v === 'hw' || v === 'virt') {
        args.mode = v
      }

      continue
    }

    if (a === '--log-level') {
      args.level = argv[i + 1] || 'info'
      i += 1
      continue
    }

    if (a === '--cli') {
      args.cli = true
      continue
    }
  }

  return args
}

export default parseArgs
