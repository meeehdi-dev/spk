import { app, dialog, globalShortcut } from 'electron'

import { readConfig, writeConfig } from './config.js'

/** Opt-in system-wide mute/deafen keys, active only while the spk window is not focused (focused windows use the web app's own keys). */
export const setupShortcuts = ({ send, rebuildMenu }) => {
  const keys = { 'CmdOrCtrl+Alt+Shift+M': 'toggle-mic', 'CmdOrCtrl+Alt+Shift+D': 'toggle-deafen' }
  const enabled = () => readConfig().globalShortcuts === true
  let focused = false
  let warned = false
  let hasWindow = false

  const unregister = () => {
    for (const accel of Object.keys(keys)) globalShortcut.unregister(accel)
  }

  const apply = () => {
    unregister()
    if (focused || !enabled() || (process.platform === 'darwin' && !hasWindow)) return
    for (const [accel, cmd] of Object.entries(keys)) {
      if (globalShortcut.register(accel, () => send(cmd)) || warned) continue
      warned = true
      void dialog.showMessageBox({ type: 'warning', message: `Global shortcut ${accel} is in use by another app` })
    }
  }

  app.on('will-quit', unregister)

  return {
    menuItem: () => ({
      label: 'Global shortcuts',
      type: 'checkbox',
      checked: enabled(),
      click: ({ checked }) => {
        writeConfig({ globalShortcuts: checked })
        apply()
        rebuildMenu()
      },
    }),
    windowHook: win => {
      hasWindow = true
      focused = win.isFocused()
      apply()
      win.on('focus', () => {
        focused = true
        apply()
      })
      win.on('blur', () => {
        focused = false
        apply()
      })
      win.on('closed', () => {
        hasWindow = false
        focused = false
        apply()
      })
    },
  }
}
