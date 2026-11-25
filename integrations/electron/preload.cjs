const { contextBridge, ipcRenderer } = require('electron')

// Duplicated from state.js COMMANDS: a sandboxed preload cannot import ESM.
const COMMANDS = new Set(['toggle-mic', 'toggle-deafen', 'toggle-camera', 'toggle-screen', 'leave', 'settings', 'ptt-down', 'ptt-up'])

contextBridge.exposeInMainWorld('spkDesktop', {
  setServer: url => ipcRenderer.invoke('spk:set-server', url),
  voiceState: state => ipcRenderer.send('spk:voice-state', state),
  attention: () => ipcRenderer.send('spk:attention'),
  focus: () => ipcRenderer.send('spk:focus'),
  screenAudioFailed: () => ipcRenderer.send('spk:screen-audio-failed'),
  onCommand: cb => {
    const listener = (_event, cmd) => COMMANDS.has(cmd) && cb(cmd)
    ipcRenderer.on('spk:command', listener)
    return () => ipcRenderer.removeListener('spk:command', listener)
  },
})

let last = -1
setInterval(() => {
  const count = Number(document.querySelector('meta[name="spk-unread"]')?.getAttribute('content'))
  const next = Number.isSafeInteger(count) && count > 0 ? count : 0
  if (next !== last) ipcRenderer.send('spk:unread', (last = next))
}, 1000)
