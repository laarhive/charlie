// src/cli/cliHelp.js

/**
 * Prints CLI help text.
 *
 * @param {object} opts
 * @param {'local'|'ws'} opts.mode
 *
 * @example
 * printHelp({ mode: 'ws' })
 */
export const printHelp = function printHelp({ mode }) {
  console.log('')
  console.log('Commands (press Tab for context-aware completion):')
  console.log('  inject on|off|status')
  console.log('  presence front|back on|off')
  console.log('  vibration low|high')
  console.log('  button short|long')
  console.log('  driver list|enable|disable <sensorId>')
  console.log('  tap main|presence|vibration|button|tasker|all on|off|status')
  console.log('  core state')
  console.log('  config print')

  if (mode === 'local') {
    console.log('  virt list|set <sensorId> on|off')
    console.log('  virt press <sensorId> [ms]')
    console.log('  clock now|status|freeze|resume|+MS|set YYYY-MM-DD HH:MM')
    console.log('  config load <filename>')
  }

  console.log('  help')
  console.log('  exit')

  if (mode === 'ws') {
    console.log('')
    console.log('Notes:')
    console.log('  - virt * and clock * are local-only')
    console.log('  - config load is not supported via WS')
  }

  console.log('')
}

export default printHelp
