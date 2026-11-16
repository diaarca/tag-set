const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setwisePlaybackHost', {
  report: (message) => ipcRenderer.send('wrapper-playback', message),
});
