// src/main/preload.js — Electron contextBridge
// ─────────────────────────────────────────────────────────────────────────────
// Exposes a minimal, typed API surface to the renderer process.
// The renderer CANNOT require() Node modules — everything goes through this bridge.
// ─────────────────────────────────────────────────────────────────────────────
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Auth / token storage (tokens kept in main process, safer than localStorage) ──
  auth: {
    saveTokens:  (tokens)  => ipcRenderer.invoke('auth:save-tokens', tokens),
    getTokens:   ()        => ipcRenderer.invoke('auth:get-tokens'),
    clearTokens: ()        => ipcRenderer.invoke('auth:clear-tokens'),
  },

  // ── Shell ──────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // ── Window title ──────────────────────────────────────────────────────────
  setTitle: (title) => ipcRenderer.send('set-title', title),

  // ── Version info ──────────────────────────────────────────────────────────
  versions: {
    electron: process.versions.electron,
    node:     process.versions.node,
  },
})
