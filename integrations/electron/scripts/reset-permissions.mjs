// `pnpm reset-permissions`: clear spk's macOS privacy permissions (quit spk first).
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.log('reset-permissions only applies to macOS.')
  process.exit(0)
}

try {
  execFileSync('pgrep', ['-f', 'spk.app/Contents/MacOS'], { stdio: 'ignore' })
  console.error('spk is running. Quit it and try again.')
  process.exit(1)
} catch {
  // pgrep exits non-zero when nothing matches: spk is not running
}

// Packaged builds and the `pnpm start` copy ("spk dev").
for (const id of ['dev.spk.desktop', 'dev.spk.desktop.dev'])
  for (const service of ['Microphone', 'Camera', 'ScreenCapture', 'AudioCapture', 'Accessibility', 'ListenEvent']) {
    try {
      console.log(execFileSync('tccutil', ['reset', service, id], { encoding: 'utf8' }).trim())
    } catch (error) {
      console.error(`${id} ${service}: ${error.message.split('\n')[0]}`)
    }
  }
