import { app, Menu, shell } from 'electron'

import { isKnown, onVoice, voice } from './state.js'

/** Voice controls as menu items. registerAccelerator is false: on Windows/Linux the accelerator is display-only (electron.d.ts, linux/win32 only); the web app handles the keys. */
const voiceItem = (label, accel, checked, enabled, click) => ({
  label,
  accelerator: `CmdOrCtrl+Alt+Shift+${accel}`,
  registerAccelerator: false,
  type: 'checkbox',
  checked,
  enabled,
  click,
})

/** Mute, Deafen and Leave: the subset shared by the dock and tray menus. */
export const voiceItems = (state, send) => [
  { label: 'Mute microphone', type: 'checkbox', checked: state.muted, enabled: state.inCall, click: () => send('toggle-mic') },
  { label: 'Deafen', type: 'checkbox', checked: state.deafened, enabled: state.inCall, click: () => send('toggle-deafen') },
  { label: 'Leave call', enabled: state.inCall, click: () => send('leave') },
]

/** extraItems(): feature toggles (global shortcuts, push-to-talk) appended to the spk/File menu. */
export const setupMenu = ({ changeServer, getServer, send, extraItems = () => [] }) => {
  const mac = process.platform === 'darwin'
  const loginItem = mac || process.platform === 'win32'

  const build = () => {
    const known = isKnown()
    const live = known && voice.inCall
    const login = loginItem
      ? [
          {
            label: 'Open at login',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: ({ checked }) => app.setLoginItemSettings({ openAtLogin: checked }),
          },
        ]
      : []
    const common = [
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', enabled: known, click: () => send('settings') },
      { label: 'Change server…', click: changeServer },
      ...login,
      { type: 'separator' },
      ...extraItems(),
    ]
    const server = getServer()
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        mac
          ? {
              label: 'spk',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                ...common,
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            }
          : { label: 'File', submenu: [...common, { role: 'quit' }] },
        {
          label: 'Voice',
          submenu: [
            voiceItem('Mute microphone', 'M', voice.muted, live, () => send('toggle-mic')),
            voiceItem('Deafen', 'D', voice.deafened, live, () => send('toggle-deafen')),
            voiceItem('Camera', 'E', voice.camOn, live, () => send('toggle-camera')),
            voiceItem('Share screen', 'S', voice.screenOn, live, () => send('toggle-screen')),
            { type: 'separator' },
            { label: 'Leave call', enabled: live, click: () => send('leave') },
          ],
        },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
          ],
        },
        { role: 'windowMenu' },
        {
          role: 'help',
          submenu: [
            { label: `Open ${server ?? 'server'} in browser`, enabled: !!server, click: () => shell.openExternal(server) },
            { label: 'spk on GitHub', click: () => shell.openExternal('https://github.com/meeehdi-dev/spk') },
          ],
        },
      ]),
    )
    if (mac) app.dock.setMenu(Menu.buildFromTemplate(voiceItems({ ...voice, inCall: live }, send)))
  }

  build()
  onVoice(build)
  return build // call after the server changes
}
