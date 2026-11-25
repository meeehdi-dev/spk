// `pnpm start`: on macOS, run Electron from a renamed copy (.dev/spk.app) so the menu bar and dock show spk and its icon.
// The copy is rebuilt when the Electron version or the stamp format changes. node_modules is never modified: pnpm hardlinks it from a shared store.
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const binary = require('electron') // path to the stock Electron binary
const DEV_ID = 'dev.spk.desktop.dev'

if (process.platform === 'darwin') {
  const version = `${require('electron/package.json').version}:3`
  const app = join(root, '.dev/spk.app')
  const stamp = join(root, '.dev/version')
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    rmSync(join(root, '.dev'), { recursive: true, force: true })
    cpSync(join(dirname(binary), '../..'), app, { recursive: true, verbatimSymlinks: true })
    // Own bundle id ("spk dev"), separate from packaged builds: both are ad-hoc signed with different signatures, and
    // sharing an id makes System Settings show one entry whose toggle doesn't apply to the copy that is running.
    const set = (plist, values) => {
      for (const [key, value] of Object.entries(values)) execFileSync('plutil', ['-replace', key, '-string', value, plist])
    }
    set(join(app, 'Contents/Info.plist'), { CFBundleName: 'spk', CFBundleDisplayName: 'spk dev', CFBundleIdentifier: DEV_ID })
    // Helpers (renderer, GPU, ...) make the media requests; keep them under the app's id instead of Electron's.
    for (const helper of readdirSync(join(app, 'Contents/Frameworks')).filter(name => name.endsWith('.app'))) {
      const suffix = helper.match(/\((\w+)\)/)?.[1]
      set(join(app, 'Contents/Frameworks', helper, 'Contents/Info.plist'), { CFBundleIdentifier: `${DEV_ID}.helper${suffix ? `.${suffix}` : ''}` })
    }
    execFileSync('sips', ['-s', 'format', 'icns', join(root, '../../public/pwa-512x512.png'), '--out', join(app, 'Contents/Resources/electron.icns')], {
      stdio: 'ignore',
    })
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' }) // the edits break Electron's signature
    writeFileSync(stamp, version)
  }
}

// macOS: launch through LaunchServices (`open`), not as a child of the terminal. A child process inherits the
// terminal's privacy permissions, so spk would never get its own entry or prompts. `open -W` waits so quitting
// ends this command; `open` can't write to this terminal, so output goes through .dev/output.log.
const devApp = join(root, '.dev/spk.app/Contents/MacOS/Electron')
let child
if (process.platform === 'darwin') {
  const log = join(root, '.dev/output.log')
  writeFileSync(log, '')
  const tail = spawn('tail', ['-f', log], { stdio: 'inherit' })
  child = spawn('open', ['-W', '-n', '-o', log, '--stderr', log, join(root, '.dev/spk.app'), '--args', root, ...process.argv.slice(2)], { stdio: 'inherit' })
  child.on('exit', () => tail.kill())
} else child = spawn(binary, [root, ...process.argv.slice(2)], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    // `open` doesn't forward signals; stop the dev copy itself (matched by its path, so an installed spk is untouched).
    if (process.platform === 'darwin') spawn('pkill', [`-${signal.slice(3)}`, '-f', devApp], { stdio: 'ignore' })
    else child.kill(signal)
  })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
