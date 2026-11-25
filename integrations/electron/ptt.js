import { createRequire } from 'node:module'

import { app, dialog, systemPreferences } from 'electron'

import { readConfig, writeConfig } from './config.js'
import { onVoice, voice } from './state.js'
import { pttKeys } from './util.js'

const require = createRequire(import.meta.url)

/** Global push-to-talk via uiohook-napi, loaded lazily so a broken native module cannot stop the app. */
export const setupPtt = ({ send, rebuildMenu }) => {
  const mac = process.platform === 'darwin'
  let lib = null
  let running = false
  let capture = null // { abort, enable } while waiting for a key
  let untrusted = false // mac: enabled in config but Accessibility not granted
  let names = null
  let cfg = readConfig().ptt ?? {} // { enabled, keycode }, cached so key events never read the file

  const save = patch => writeConfig({ ptt: (cfg = { ...cfg, ...patch }) })
  const keys = pttKeys({ keycode: () => cfg.keycode, send })
  const fail = (message, detail) => void dialog.showMessageBox({ type: 'warning', message, detail, buttons: ['OK'] }).catch(() => {})
  const keyName = code => {
    if (!names) {
      try {
        names = new Map(Object.entries(require('uiohook-napi').UiohookKey).map(([name, value]) => [value, name]))
      } catch {
        names = new Map() // unavailable: fall back to the raw code
      }
    }
    return names.get(code) ?? `Key ${code}`
  }

  const load = () => {
    if (lib) return true
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi')
      uIOhook.on('keydown', e => onKey(e, true))
      uIOhook.on('keyup', e => onKey(e, false))
      lib = { uIOhook, UiohookKey }
      return true
    } catch (error) {
      fail('Push-to-talk is unavailable', `Could not load the keyboard hook: ${error.message}`)
      return false
    }
  }

  /** Start the hook only while push-to-talk is on or a key is being captured. */
  const sync = () => {
    const want = !!lib && (!!cfg.enabled || !!capture)
    if (want === running) return
    try {
      if (want) lib.uIOhook.start()
      else lib.uIOhook.stop()
      running = want
    } catch (error) {
      running = false
      if (cfg.enabled) save({ enabled: false })
      fail('Push-to-talk is unavailable', error.message)
    } finally {
      if (!running && capture) {
        capture.abort.abort()
        capture = null
      }
    }
    keys.reset()
  }

  const onKey = ({ keycode }, down) => {
    if (capture) {
      // Aborted: the dialog is still closing; ignore the extra press/auto-repeat.
      if (!down || capture.abort.signal.aborted) return
      const { abort, enable } = capture
      if (keycode !== lib.UiohookKey.Escape) {
        save(enable ? { enabled: true, keycode } : { keycode })
        keys.reset()
      }
      abort.abort()
      if (keycode !== lib.UiohookKey.Escape && enable) send('ptt-up') // start muted
      return
    }
    if (cfg.enabled) (down ? keys.down : keys.up)({ keycode })
  }

  /** mac needs Accessibility (and Input Monitoring) for a global hook; the system prompt explains it. */
  const trusted = prompt => {
    untrusted = mac && !systemPreferences.isTrustedAccessibilityClient(prompt)
    return !untrusted
  }

  const startCapture = async enable => {
    if (capture) return rebuildMenu()
    if (!trusted(true) || !load()) return rebuildMenu()
    const abort = new AbortController()
    capture = { abort, enable }
    sync()
    await dialog
      .showMessageBox({ message: 'Press the key to use for push-to-talk', detail: 'Esc cancels.', buttons: ['Cancel'], signal: abort.signal })
      .catch(() => {})
    abort.abort()
    if (capture?.abort === abort) {
      capture = null
      sync()
    }
    rebuildMenu()
  }

  const toggle = ({ checked }) => {
    if (!checked) {
      save({ enabled: false })
      sync()
      return rebuildMenu()
    }
    if (cfg.keycode === undefined) return void startCapture(true)
    if (!trusted(true) || !load()) return rebuildMenu()
    save({ enabled: true })
    sync()
    send('ptt-up')
    rebuildMenu()
  }

  app.on('will-quit', () => {
    try {
      if (running) lib.uIOhook.stop()
    } catch {
      // quitting anyway
    }
  })
  let wasInCall = false
  onVoice(({ inCall }) => {
    if (inCall && !wasInCall && running && cfg.enabled) send('ptt-up')
    wasInCall = inCall
  })
  wasInCall = voice.inCall

  // Startup: re-check trust without prompting; an untrusted config stays enabled but the hook stays off.
  try {
    if (cfg.enabled && trusted(false) && load()) sync()
  } catch (error) {
    fail('Push-to-talk is unavailable', error.message)
  }

  return {
    menuItems: () => {
      const { enabled, keycode } = cfg
      return [
        {
          label: untrusted ? 'Push-to-talk (needs Accessibility permission)' : 'Push-to-talk',
          type: 'checkbox',
          checked: !!enabled && !untrusted,
          click: toggle,
        },
        { label: keycode === undefined ? 'Set push-to-talk key…' : `Push-to-talk key: ${keyName(keycode)}…`, click: () => void startCapture(false) },
      ]
    },
  }
}
