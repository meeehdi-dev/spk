import { dialog, shell } from 'electron'

const PANES = { Microphone: 'Privacy_Microphone', Camera: 'Privacy_Camera', 'Screen Recording': 'Privacy_ScreenCapture' }
const shown = new Set()

/** macOS: explain a denied permission once per session and offer System Settings. Fire and forget. */
export const explainDenied = (win, type) => {
  if (shown.has(type)) return
  shown.add(type)
  const detail = `Allow spk in System Settings → Privacy & Security → ${type}, then try again${type === 'Screen Recording' ? ' (restart spk)' : ''}.`
  const options = { type: 'warning', message: `spk needs ${type} access`, detail, buttons: ['Open System Settings', 'Cancel'], defaultId: 0, cancelId: 1 }
  void (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    .then(({ response }) => response === 0 && shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${PANES[type]}`))
    .catch(() => {})
}
