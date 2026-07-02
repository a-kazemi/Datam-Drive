import { ipcMain, BrowserWindow } from 'electron'
import { trySso, loginWithCredentials, logout, getCurrentAuth, ensureAuthForSite } from './auth'
import { getAllLibraries } from './db/libraries'
import { getRecentEntries, setLogEmitter, LogEntry } from './logger'
import { getAllSettings, saveSettings } from './db/settings'
import { mountLibrary, unmountLibrary, enumerateLibraries } from './sync-engine/mount'
import { startPolling, stopPolling, setLibraryChangedEmitter } from './poller'
import { startWatchers, stopAllWatchers } from './watcher'
import { setTrayState, notify, refreshTray } from './tray'
import { setNotifyFn as setConflictNotify } from './conflict/resolver'
import { setNotifyFn as setUploadNotify } from './watcher/upload-queue'
import { checkForUpdates, downloadAndInstall } from './updater'
import type { Settings } from '../shared/ipc-types'

let win: BrowserWindow | null = null

export function initIpc(mainWindow: BrowserWindow): void {
  win = mainWindow

  // Wire log entries to renderer in real-time
  setLogEmitter((entry: LogEntry) => win?.webContents.send('log:entry', entry))

  // Wire tray notify to conflict resolver and upload queue
  setConflictNotify(notify)
  setUploadNotify(notify)

  // Wire library-changed event to renderer
  setLibraryChangedEmitter(() => {
    win?.webContents.send('libraries:changed')
    refreshTray()
  })

  // ── Auth ──────────────────────────────────────────────────────────
  ipcMain.handle('auth:try-sso', async (_, siteUrl: string) => {
    const result = await trySso(siteUrl)
    return result
      ? { success: true, method: 'sso', username: result.username }
      : { success: false }
  })

  ipcMain.handle('auth:login', async (_, { siteUrl, username, password }: { siteUrl: string; username: string; password: string }) => {
    try {
      const r = await loginWithCredentials(siteUrl, username, password)
      return { success: true, method: r.method, username: r.username }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('auth:logout', async () => {
    await logout()
    stopPolling()
    stopAllWatchers()
    setTrayState('idle')
    return { success: true }
  })

  ipcMain.handle('auth:status', () => {
    const a = getCurrentAuth()
    return { authenticated: a != null, siteUrl: a?.siteUrl ?? null, username: a?.username ?? null, method: a?.method ?? null }
  })

  // ── Libraries ────────────────────────────────────────────────────
  ipcMain.handle('libraries:list', () => getAllLibraries())

  ipcMain.handle('libraries:enumerate', async (_, siteUrl: string) => {
    try {
      const auth = await ensureAuthForSite(siteUrl)
      if (!auth) return { success: false, error: 'Authentication failed for this SharePoint site. Sign in to this site first.' }
      return { success: true, libraries: await enumerateLibraries(siteUrl) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('libraries:add', async (_, req: { siteUrl: string; listId: string; title: string; localRoot: string }) => {
    try {
      const r = await mountLibrary(req)
      if (r.error) return { success: false, error: r.error }
      win?.webContents.send('libraries:changed')
      refreshTray()
      return { success: true, id: r.id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('libraries:remove', async (_, id: number) => {
    unmountLibrary(id)
    win?.webContents.send('libraries:changed')
    refreshTray()
    return { success: true }
  })

  // ── Sync control ─────────────────────────────────────────────────
  ipcMain.handle('sync:pause', () => {
    stopPolling(); stopAllWatchers()
    setTrayState('paused')
    win?.webContents.send('sync:state', { paused: true })
    return { success: true }
  })

  ipcMain.handle('sync:resume', () => {
    startPolling(); startWatchers()
    setTrayState('idle')
    win?.webContents.send('sync:state', { paused: false })
    return { success: true }
  })

  ipcMain.handle('sync:status', () => {
    const libs = getAllLibraries()
    const syncing = libs.some(l => l.status === 'syncing')
    const errorCount = libs.filter(l => l.status === 'error').length
    return {
      status: syncing ? 'syncing' : errorCount > 0 ? 'error' : 'idle',
      libraryCount: libs.length,
      errorCount,
    }
  })

  // ── Log ───────────────────────────────────────────────────────────
  ipcMain.handle('log:recent', () => getRecentEntries())

  // ── Settings ──────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => getAllSettings())

  ipcMain.handle('settings:set', (_, s: Partial<Settings>) => {
    saveSettings(s)
    return { success: true }
  })

  // ── Updater ───────────────────────────────────────────────────────
  ipcMain.handle('updater:check', async () => { await checkForUpdates(); return { success: true } })
  ipcMain.handle('updater:install', async () => { await downloadAndInstall(); return { success: true } })

  // ── Window ────────────────────────────────────────────────────────
  ipcMain.handle('window:show', () => { win?.show(); win?.focus() })
}
