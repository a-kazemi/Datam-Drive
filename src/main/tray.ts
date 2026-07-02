import { Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import path from 'path'
import { getAllLibraries } from './db/libraries'

export type TrayState = 'idle' | 'syncing' | 'paused' | 'error'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let currentState: TrayState = 'idle'

export function initTray(win: BrowserWindow): void {
  mainWindow = win
  tray = new Tray(getIcon('idle'))
  tray.setToolTip('DatamDrive')
  tray.on('double-click', showWindow)
  refreshMenu()
}

export function setTrayState(state: TrayState): void {
  currentState = state
  tray?.setImage(getIcon(state))
  tray?.setToolTip(`DatamDrive — ${state}`)
  refreshMenu()
}

export function notify(message: string): void {
  tray?.displayBalloon({ title: 'DatamDrive', content: message, iconType: 'info' })
}

export function refreshTray(): void {
  refreshMenu()
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function refreshMenu(): void {
  if (!tray) return
  const libraries = getAllLibraries()

  const libItems = libraries.length > 0
    ? libraries.map(l => Menu.buildFromTemplate([{
        label: `${l.title} (${l.permission_level.toUpperCase()})`,
        enabled: false,
      }]))
    : undefined

  const paused = currentState === 'paused'

  const menu = Menu.buildFromTemplate([
    { label: 'DatamDrive', enabled: false },
    { label: `${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} · ${currentState}`, enabled: false },
    { type: 'separator' },
    { label: 'Open DatamDrive', click: showWindow },
    {
      label: 'Libraries',
      submenu: libraries.length > 0
        ? libraries.map(l => ({ label: `${l.title} (${l.permission_level.toUpperCase()})`, enabled: false }))
        : [{ label: 'No libraries — click Open to add', enabled: false }],
    },
    {
      label: paused ? 'Resume Sync' : 'Pause Sync',
      click: () => mainWindow?.webContents.send('sync:toggle'),
    },
    { type: 'separator' },
    { label: 'Settings',     click: () => { showWindow(); mainWindow?.webContents.send('navigate', 'settings') } },
    { label: 'Activity Log', click: () => { showWindow(); mainWindow?.webContents.send('navigate', 'log') } },
    { type: 'separator' },
    { label: 'Quit DatamDrive', role: 'quit' },
  ])

  tray.setContextMenu(menu)
}

function getIcon(state: TrayState): Electron.NativeImage {
  const name = state === 'error' ? 'icon-error.ico' : state === 'syncing' ? 'icon-sync.ico' : 'icon.ico'
  const image = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', name))
  return image.isEmpty() ? nativeImage.createEmpty() : image
}
