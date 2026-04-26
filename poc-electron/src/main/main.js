// src/main/main.js — Electron main process
const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'YourBrand App',
    backgroundColor: '#0a0a0f',
    show: false,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools HIDDEN for clean demo — uncomment to re-enable debugging:
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('set-title', (event, title) => {
  mainWindow?.setTitle(title)
})

// ── Secure in-memory token storage (Phase 5) ────────────────────────────────
// Tokens are never written to disk — stored only in main process memory.
// The renderer requests them via IPC; it cannot access them directly.
let _tokens = null  // { accessToken, refreshToken, expiresAt }

ipcMain.handle('auth:save-tokens', (event, tokens) => {
  _tokens = tokens
  return true
})

ipcMain.handle('auth:get-tokens', () => {
  return _tokens
})

ipcMain.handle('auth:clear-tokens', () => {
  _tokens = null
  return true
})
