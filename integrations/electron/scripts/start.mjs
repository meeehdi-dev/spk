// `pnpm start`: on macOS, run Electron from a renamed copy (.dev/spk.app) so the menu bar and dock show spk and its icon.
// The copy is rebuilt when the Electron version or the stamp format changes. node_modules is never modified: pnpm hardlinks it from a shared store.
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
let binary = require('electron') // path to the stock Electron binary

if (process.platform === 'darwin') {
  const version = `${require('electron/package.json').version}:2`
  const app = join(root, '.dev/spk.app')
  const stamp = join(root, '.dev/version')
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    rmSync(join(root, '.dev'), { recursive: true, force: true })
    cpSync(join(dirname(binary), '../..'), app, { recursive: true, verbatimSymlinks: true })
    const plist = join(app, 'Contents/Info.plist')
    for (const [key, value] of [
      ['CFBundleName', 'spk'],
      ['CFBundleDisplayName', 'spk'],
      ['CFBundleIdentifier', 'dev.spk.desktop'], // same as packaged builds, so macOS shows a single spk entry in Privacy settings
    ])
      execFileSync('plutil', ['-replace', key, '-string', value, plist])
    execFileSync('sips', ['-s', 'format', 'icns', join(root, '../../public/pwa-512x512.png'), '--out', join(app, 'Contents/Resources/electron.icns')], {
      stdio: 'ignore',
    })
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' }) // the edits break Electron's signature
    writeFileSync(stamp, version)
  }
  binary = join(app, 'Contents/MacOS/Electron')
}

const child = spawn(binary, [root, ...process.argv.slice(2)], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
