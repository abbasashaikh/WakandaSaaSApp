// src/main/preload.js — Context bridge (secure IPC)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Open a URL in the system's default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Get the app version from package.json
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Platform info
  platform: process.platform,
})
