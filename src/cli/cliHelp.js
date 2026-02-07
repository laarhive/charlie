// src/cli/cliHelp.js
import { printRecordingHelp } from './recording/cliRecording.js'

export const printHelp = ({ mode }) => {
  console.log('')
  console.log('Commands:')
  console.log('  inject on|off|status')
  console.log('  presence front|back on|off')
  console.log('  vibration low|high')
  console.log('  button short|long')
  console.log('  device list|block|unblock <deviceId>')
  console.log('  device inject <deviceId> <payload...>')
  console.log('  core state')
  console.log('  config print')

  printRecordingHelp({ mode })

  if (mode === 'local') {
    console.log('  clock now|status|freeze|resume|+MS|set YYYY-MM-DD HH:MM')
    console.log('  config load <filename>')
  }

  console.log('  help')
  console.log('  exit')
  console.log('')
}

export default printHelp
