// src/cli/cliHelp.js
export const printHelp = function printHelp({ mode }) {
  console.log('')
  console.log('Commands:')
  console.log('  inject on|off|status')
  console.log('  presence front|back on|off')
  console.log('  vibration low|high')
  console.log('  button short|long')
  console.log('  device list|block|unblock <deviceId>')
  console.log('  device inject <deviceId> <payload...>')
  console.log('  tap main|presence|vibration|button|tasker|all on|off|status')
  console.log('  core state')
  console.log('  config print')

  if (mode === 'local') {
    console.log('  clock now|status|freeze|resume|+MS|set YYYY-MM-DD HH:MM')
    console.log('  config load <filename>')
  }

  if (mode === 'ws') {
    console.log('')
    console.log('Notes:')
    console.log('  - clock * is local-only')
    console.log('  - config load is not supported via WS')
    console.log('  - inject * gates only semantic injections (main bus)')
  }

  console.log('  help')
  console.log('  exit')
  console.log('')
}

export default printHelp
