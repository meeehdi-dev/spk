import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell, systemPreferences } from 'electron'

const dir = fileURLToPath(new URL('.', import.meta.url))
const setupUrl = pathToFileURL(join(dir, 'setup.html')).href
const configFile = () => join(app.getPath('userData'), 'config.json')
const PERMISSIONS = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'screen-wake-lock'])

let win
let server = null

const readServer = () => {
  try {
    return parseServer(JSON.parse(readFileSync(configFile(), 'utf8')).server)
  } catch {
    return null
  }
}
const isServer = url => {
  try {
    return !!server && new URL(url).origin === server
  } catch {
    return false
  }
}
const isSetup = url => url.split(/[?#]/)[0] === setupUrl
const isHttp = url => /^https?:$/.test(new URL(url).protocol)

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
  win.on('closed', () => {
    win = null
    app.setBadgeCount(0)
  })
  void (setup ? showSetup() : load())
}

const setupSession = () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, permission, origin) => PERMISSIONS.has(permission) && isServer(origin))
  ses.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (!PERMISSIONS.has(permission) || !isServer(details.requestingUrl)) return callback(false)
    if (permission === 'media' && process.platform === 'darwin') {
      try {
        for (const type of details.mediaTypes ?? [])
          if (!(await systemPreferences.askForMediaAccess(type === 'audio' ? 'microphone' : 'camera'))) return callback(false)
      } catch {
        return callback(false)
      }
    }
    callback(true)
  })
  // No useSystemPicker: the macOS picker returns video only, so screen audio would be silently dropped.
  // shortcut: always shares the first screen, add a source picker if window sharing is needed.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isServer(request.securityOrigin)) return callback({})
      const [screen] = await desktopCapturer.getSources({ types: ['screen'] })
      const loopback = request.audioRequested && process.platform !== 'linux' // system audio: Windows, macOS 14.2+
      callback(screen ? { video: screen, ...(loopback && { audio: 'loopback' }) } : {})
    } catch {
      callback({})
    }
  })
}

const setupIpc = () => {
  ipcMain.on('spk:unread', (event, count) => {
    if (!isServer(event.senderFrame?.url ?? '')) return
    app.setBadgeCount(Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 0), 999999) : 0)
  })
  ipcMain.handle('spk:set-server', (event, input) => {
    if (!isSetup(event.senderFrame?.url ?? '')) return 'Not allowed'
    const origin = parseServer(input)
    if (!origin) return 'Enter an https:// URL (http:// only for localhost)'
    writeFileSync(configFile(), JSON.stringify({ server: origin }))
    server = origin
    void win.loadURL(origin).catch(() => {})
  })
}

const setupMenu = () => {
  const changeServer = { label: 'Change server…', click: () => (win ? showSetup() : createWindow({ setup: true })) }
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [changeServer, { type: 'separator' }, { role: mac ? 'close' : 'quit' }] },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    server = readServer()
    setupSession()
    setupIpc()
    setupMenu()
    createWindow()
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  })
  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
}
