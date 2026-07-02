import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb, closeDb } from './db/schema'
import { initIpc } from './ipc'
import { initTray, setTrayState } from './tray'
import { startPolling, stopPolling } from './poller'
import { startWatchers, stopAllWatchers } from './watcher'
import { applyWindowsStartupSetting, runStartupDirtyScan } from './startup'
import { initUpdater } from './updater'
import { log } from './logger'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    show: false,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Minimize to tray on normal close, but allow real application quits.
  mainWindow.on('close', e => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  initDb()
  log('info', 'app.start', '', `DatamDrive ${app.getVersion()} starting`)

  createWindow()
  if (mainWindow) { initIpc(mainWindow); initTray(mainWindow) }

  applyWindowsStartupSetting()

  // T4: Startup dirty-row scan before watchers begin
  runStartupDirtyScan()
  startPolling()
  startWatchers()

  // T10: Updater respects opt-in setting; no outbound call if disabled
  initUpdater()
})

app.on('before-quit', () => {
  isQuitting = true
  stopPolling()
  stopAllWatchers()
  log('info', 'app.stop', '', 'Shutting down')
  closeDb()
})

// Keep alive in system tray on Windows
app.on('window-all-closed', () => { /* intentional no-op — tray keeps app alive */ })
