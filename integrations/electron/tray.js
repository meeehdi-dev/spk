import { fileURLToPath } from 'node:url'

import { app, Menu, nativeImage, Tray } from 'electron'

import { voiceItems } from './menu.js'
import { isKnown, onVoice, voice } from './state.js'

const icon = name => nativeImage.createFromPath(fileURLToPath(new URL(`assets/${name}.png`, import.meta.url)))

/** Windows/Linux tray and Windows thumbnail buttons. No-op on macOS (the dock menu covers it). Returns { windowHook(win) }. */
export const setupTray = ({ send, showWindow }) => {
  if (process.platform === 'darwin') return { windowHook: () => {} }

  const tray = new Tray(icon('tray'))
  tray.on('click', showWindow)

  const update = () => {
    const live = isKnown() && voice.inCall
    const status = live ? ['In call', voice.muted && 'muted', voice.deafened && 'deafened'].filter(Boolean).join(' · ') : ''
    tray.setToolTip(status ? `spk – ${status}` : 'spk')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show spk', click: showWindow },
        { type: 'separator' },
        ...voiceItems({ ...voice, inCall: live }, send),
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    )
  }
  update()
  onVoice(update)

  const thumbar = win => {
    if (win.isDestroyed()) return
    const live = isKnown() && voice.inCall
    win.setThumbarButtons(
      live
        ? [
            { tooltip: voice.muted ? 'Unmute' : 'Mute', icon: icon(voice.muted ? 'mic-off' : 'mic'), click: () => send('toggle-mic') },
            {
              tooltip: voice.deafened ? 'Undeafen' : 'Deafen',
              icon: icon(voice.deafened ? 'headphone-off' : 'headphones'),
              click: () => send('toggle-deafen'),
            },
            { tooltip: 'Leave call', icon: icon('phone-off'), click: () => send('leave') },
          ]
        : [],
    )
  }

  const windowHook = win => {
    if (process.platform !== 'win32') return
    const apply = () => thumbar(win)
    apply()
    win.on('show', apply)
    const off = onVoice(apply)
    win.once('closed', off)
  }

  return { windowHook }
}
