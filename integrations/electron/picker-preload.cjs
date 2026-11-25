const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spkPicker', {
  sources: () => ipcRenderer.invoke('spk:picker:sources'),
  choose: (id, audio) => ipcRenderer.send('spk:picker:choose', id, audio),
})
