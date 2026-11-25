const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spkDesktop', { setServer: url => ipcRenderer.invoke('spk:set-server', url) })

let last = -1
setInterval(() => {
  const count = Number(document.querySelector('meta[name="spk-unread"]')?.getAttribute('content'))
  const next = Number.isSafeInteger(count) && count > 0 ? count : 0
  if (next !== last) ipcRenderer.send('spk:unread', (last = next))
}, 1000)
