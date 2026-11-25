import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { BrowserWindow, desktopCapturer, ipcMain, systemPreferences } from 'electron'

import { explainDenied } from './permissions.js'
import { once } from './util.js'

const dir = fileURLToPath(new URL('.', import.meta.url))
const pickerUrl = pathToFileURL(join(dir, 'picker.html')).href

let current = null // { win, sources, audio, finish } while a request is open

const isPicker = event => !!current?.win && event.sender === current.win.webContents && event.senderFrame?.url.split(/[?#]/)[0] === pickerUrl
const kind = source => (source.id.startsWith('screen:') ? 'screen' : 'window')

/** Owns the display-media handler: grants a lone screen directly, otherwise asks through a modal picker window. */
export const setupPicker = ({ session, getWindow, isServer }) => {
  ipcMain.handle('spk:picker:sources', event => {
    if (!isPicker(event)) return { audio: false, sources: [] }
    return {
      audio: current.audio,
      sources: current.sources.map(s => ({
        id: s.id,
        name: s.name,
        kind: kind(s),
        thumb: s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      })),
    }
  })
  ipcMain.on('spk:picker:choose', (event, id, audio) => {
    if (isPicker(event)) current.finish(typeof id === 'string' ? id : null, audio === true)
  })

  session.setDisplayMediaRequestHandler(async (request, cb) => {
    const callback = once(cb)
    const parent = getWindow()
    if (!isServer(request.securityOrigin) || current || !parent) return callback(null)
    const state = (current = { win: null, sources: [], audio: false, finish: () => {} })
    const reject = () => {
      if (current === state) current = null
      callback(null)
    }
    try {
      // getSources triggers the macOS permission prompt, so check the status only after it
      const all = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
        explainDenied(parent, 'Screen Recording')
        return reject()
      }
      const own = parent.getMediaSourceId()
      const sources = all.filter(s => s.id !== own)
      const audio = request.audioRequested && process.platform !== 'linux' // system audio: Windows, macOS 14.2+
      const screens = sources.filter(s => kind(s) === 'screen')
      if (!sources.length || parent.isDestroyed()) return reject()
      if (screens.length === 1 && sources.length === 1) {
        current = null
        return callback({ video: screens[0], ...(audio && { audio: 'loopback' }) })
      }

      const picker = new BrowserWindow({
        parent,
        modal: true,
        width: 720,
        height: 520,
        title: 'Share your screen',
        backgroundColor: '#18181b',
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(dir, 'picker-preload.cjs') },
      })
      picker.setMenu(null)
      picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      picker.webContents.on('will-navigate', event => event.preventDefault())
      picker.webContents.on('will-redirect', event => event.preventDefault())
      Object.assign(state, {
        win: picker,
        sources,
        audio,
        finish: (id, share) => {
          if (current === state) current = null
          const video = sources.find(s => s.id === id)
          callback(video ? { video, ...(share && audio && { audio: 'loopback' }) } : null)
          if (!picker.isDestroyed()) picker.destroy()
        },
      })
      picker.on('closed', () => state.finish(null, false))
      await picker.loadURL(pickerUrl)
    } catch {
      if (state.win) state.finish(null, false)
      else reject()
    }
  })
}
