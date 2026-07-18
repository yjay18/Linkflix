/* Exposes a tiny, safe bridge to the renderer for native file/folder pickers.
   contextIsolation is on, so the frontend only sees these explicit methods. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkflix', {
  isElectron: true,
  pickVideoFile: () => ipcRenderer.invoke('pick-video-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  playNative: (path, title) => ipcRenderer.invoke('play-native', { path, title }),
  openExternalFile: (path) => ipcRenderer.invoke('open-external-file', { path })
});
