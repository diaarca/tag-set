const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tagsetPlaybackHost', {
  report: (message) => ipcRenderer.send('wrapper-playback', message),
});
