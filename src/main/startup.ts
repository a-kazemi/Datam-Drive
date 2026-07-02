import { app } from 'electron'
import { getDirtyItems } from './db/sync-items'
import { getAllLibraries } from './db/libraries'
import { getAllSettings } from './db/settings'
import { enqueueUpload } from './watcher/upload-queue'
import { log } from './logger'
import path from 'path'

export function applyWindowsStartupSetting(startWithWindows = getAllSettings().startWithWindows): void {
  if (process.platform !== 'win32') return

  try {
    app.setLoginItemSettings({
      name: 'DatamDrive',
      openAtLogin: startWithWindows,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    })
    log('info', 'startup.login-item', '', startWithWindows ? 'Enabled Windows startup' : 'Disabled Windows startup')
  } catch (err) {
    log('warn', 'startup.login-item.failed', '', String(err))
  }
}

// T4: On launch, scan for any dirty rows (from crash or mid-upload quit) and re-queue them
export function runStartupDirtyScan(): void {
  const dirty = getDirtyItems()
  if (dirty.length === 0) return

  const libraries = getAllLibraries()
  const roots = libraries.map(l => ({ root: l.local_root, id: l.id }))

  log('info', 'startup.dirty-scan', '', `${dirty.length} dirty items — re-queuing uploads`)

  for (const item of dirty) {
    const lib = roots.find(r => item.local_path.startsWith(r.root + path.sep) || item.local_path === r.root)
    if (!lib) {
      log('warn', 'startup.orphan', item.local_path, 'No matching library — skipping')
      continue
    }
    enqueueUpload(item.local_path, lib.id)
  }
}
