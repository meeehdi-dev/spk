import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain, powerSaveBlocker, session, shell, systemPreferences } from 'electron'

import { readConfig, setConfigFile, writeConfig } from './config.js'
import { setupMenu } from './menu.js'
import { explainDenied } from './permissions.js'
import { setupPicker } from './picker.js'
import { setupPtt } from './ptt.js'
import { setupShortcuts } from './shortcuts.js'
import { COMMANDS, onVoice, resetVoice, setVoice } from './state.js'
import { setupTray } from './tray.js'

const dir = fileURLToPath(new URL('.', import.meta.url))
const setupUrl = pathToFileURL(join(dir, 'setup.html')).href
const PERMISSIONS = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'screen-wake-lock'])

let win
let server = null
let rebuildMenu

const readServer = () => parseServer(readConfig().server)
const isServer = url => {
  try {
    return !!server && new URL(url).origin === server
  } catch {
    return false
  }
}
const isSetup = url => url.split(/[?#]/)[0] === setupUrl
const isHttp = url => /^https?:$/.test(new URL(url).protocol)

/** Send a voice command to the web app. */
const send = cmd => {
  if (COMMANDS.has(cmd) && win && isServer(win.webContents.getURL())) win.webContents.send('spk:command', cmd)
}

let blocker = null
const stopBlocker = () => {
  if (blocker !== null) powerSaveBlocker.stop(blocker)
  blocker = null
}

const showSetup = (error = '') => win.loadURL(`${setupUrl}?${new URLSearchParams({ server: server ?? '', error })}`)
const load = () => (server ? win.loadURL(server).catch(() => {}) : showSetup()) // failures are handled by did-fail-load

/** https anywhere, http only for loopback. Returns an origin or null. */
const parseServer = input => {
  try {
    const url = new URL(String(input).trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : null
  } catch {
    return null
  }
}

const external = url => {
  try {
    if (isHttp(url)) void shell.openExternal(url)
  } catch {
    // malformed URL: ignore
  }
}

const createWindow = ({ setup = false } = {}) => {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#18181b',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(dir, 'preload.cjs') },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url)
    return { action: 'deny' }
  })
  const guard = (event, url) => {
    if (isServer(url) || isSetup(url)) return
    event.preventDefault()
    external(url)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', event => {
    if (!event.isMainFrame || isServer(event.url) || isSetup(event.url)) return
    event.preventDefault()
    // The cancelled load fails with ERR_ABORTED, which did-fail-load ignores, so explain it here.
    void showSetup(`${server} redirected to ${new URL(event.url).origin}`)
  })
  win.webContents.on('did-fail-load', (_event, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isServer(url)) void showSetup(`Could not reach ${server}`)
  })
  win.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => isMainFrame && !isSameDocument && resetVoice())
  win.webContents.on('render-process-gone', resetVoice)
  win.on('focus', () => process.platform !== 'darwin' && win.flashFrame(false))
  win.on('closed', () => {
    win = null
    resetVoice()
    app.setBadgeCount(0)
  })
  for (const fn of windowHooks) fn(win)
  void (setup ? showSetup() : load())
}

/** Features (tray, shortcuts) attach their window listeners here; called for each new window. */
const windowHooks = []

const showWindow = () => {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

const setupSession = () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, permission, origin) => PERMISSIONS.has(permission) && isServer(origin))
  ses.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (!PERMISSIONS.has(permission) || !isServer(details.requestingUrl)) return callback(false)
    if (permission === 'media' && process.platform === 'darwin') {
      try {
        for (const type of details.mediaTypes ?? []) {
          if (await systemPreferences.askForMediaAccess(type === 'audio' ? 'microphone' : 'camera')) continue
          explainDenied(win, type === 'audio' ? 'Microphone' : 'Camera')
          return callback(false)
        }
      } catch {
        return callback(false)
      }
    }
    callback(true)
  })
  // No useSystemPicker: the macOS picker returns video only, so screen audio would be silently dropped.
  setupPicker({ session: ses, getWindow: () => win, isServer })
}

const setupIpc = () => {
  ipcMain.on('spk:unread', (event, count) => {
    if (!isServer(event.senderFrame?.url ?? '')) return
    app.setBadgeCount(Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 0), 999999) : 0)
  })
  ipcMain.on('spk:attention', event => {
    if (!isServer(event.senderFrame?.url ?? '') || !win || win.isFocused()) return
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    else win.flashFrame(true)
  })
  ipcMain.on('spk:focus', event => {
    if (isServer(event.senderFrame?.url ?? '') && win) showWindow()
  })
  ipcMain.on('spk:voice-state', (event, state) => {
    const frame = event.senderFrame
    if (frame === event.sender.mainFrame && isServer(frame.url)) setVoice(state)
  })
  onVoice(({ inCall }) => {
    if (inCall && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
    else if (!inCall) stopBlocker()
  })
  ipcMain.handle('spk:set-server', (event, input) => {
    if (!isSetup(event.senderFrame?.url ?? '')) return 'Not allowed'
    const origin = parseServer(input)
    if (!origin) return 'Enter an https:// URL (http:// only for localhost)'
    writeConfig({ server: origin })
    server = origin
    rebuildMenu()
    void win.loadURL(origin).catch(() => {})
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    setConfigFile(join(app.getPath('userData'), 'config.json'))
    app.setAboutPanelOptions({ applicationName: 'spk', applicationVersion: app.getVersion(), website: 'https://github.com/meeehdi-dev/spk' })
    server = readServer()
    setupSession()
    setupIpc()
    const shortcuts = setupShortcuts({ send, rebuildMenu: () => rebuildMenu() })
    const ptt = setupPtt({ send, rebuildMenu: () => rebuildMenu() })
    windowHooks.push(shortcuts.windowHook, setupTray({ send, showWindow }).windowHook)
    rebuildMenu = setupMenu({
      changeServer: () => (win ? showSetup() : createWindow({ setup: true })),
      getServer: () => server,
      send,
      extraItems: () => [shortcuts.menuItem(), ...ptt.menuItems(), { type: 'separator' }],
    })
    createWindow()
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  })
  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
}
