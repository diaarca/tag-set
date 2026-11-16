const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setwiseHost', {
  send: (command) => ipcRenderer.send('wrapper-command', command),
  request: (operation, payload) =>
    ipcRenderer.invoke('wrapper-request', operation, payload),
  onMessage: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('wrapper-message', handler);
    return () => ipcRenderer.removeListener('wrapper-message', handler);
  },
});
