import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs'
import { getAllLibraries, updateStatus } from '../db/libraries'
import { getByLocalPath, insertSyncItem, markDirty } from '../db/sync-items'
import { enqueueUpload, enqueueDelete, enqueueRename, enqueueMkdir } from './upload-queue'
import { consumeSuppressedLocalWrite } from './suppression'
import { log } from '../logger'

// Files matching these patterns are never uploaded and never trigger sync
const EXCLUDE: RegExp[] = [
  /^~\$/,        // Office lock files (Word, Excel)
  /\.tmp$/i,     // Temp files
  /\.TMP$/,
  /^desktop\.ini$/i,
  /^thumbs\.db$/i,
  /^\.ds_store$/i,
  /\.lnk$/i,     // Windows shortcuts
  /^\./,         // Dot/hidden files
]

const DEBOUNCE_MS = 500
const RENAME_WINDOW_MS = 200

const watchers = new Map<number, FSWatcher>()
// srcPath → { time, libraryId } for rename detection
const recentUnlinks = new Map<string, { time: number; libraryId: number }>()

export function startWatchers(): void {
  for (const lib of getAllLibraries()) {
    startWatcher(lib.id, lib.local_root)
  }
}

export function startWatcher(libraryId: number, localRoot: string): void {
  if (watchers.has(libraryId)) return

  const watcher = chokidar.watch(localRoot, {
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (p: string) => {
      const base = path.basename(p)
      return EXCLUDE.some(re => re.test(base))
    },
    awaitWriteFinish: { stabilityThreshold: DEBOUNCE_MS, pollInterval: 100 },
  })

  watcher.on('add',    fp => onAdd(fp, libraryId))
  watcher.on('change', fp => onChange(fp, libraryId))
  watcher.on('unlink', fp => onUnlink(fp, libraryId))
  watcher.on('addDir', dp => onAddDir(dp, libraryId))
  watcher.on('error',  err => {
    log('error', 'watcher.error', localRoot, String(err))
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      log('error', 'watcher.root-deleted', localRoot, 'Watched root deleted — pausing sync')
      updateStatus(libraryId, 'error')
    }
  })

  watchers.set(libraryId, watcher)
  log('info', 'watcher.started', localRoot, `libraryId=${libraryId}`)
}

export function stopWatcher(libraryId: number): void {
  const w = watchers.get(libraryId)
  if (w) { w.close(); watchers.delete(libraryId) }
}

export function stopAllWatchers(): void {
  for (const id of [...watchers.keys()]) stopWatcher(id)
}

function onAdd(filePath: string, libraryId: number): void {
  const now = Date.now()
  if (consumeSuppressedLocalWrite(filePath)) return
  if (isCleanSyncedFile(filePath)) return

  // T2: Check if this is the "dst" half of a rename (within 200ms of an unlink)
  for (const [srcPath, info] of recentUnlinks) {
    if (info.libraryId === libraryId && now - info.time <= RENAME_WINDOW_MS) {
      recentUnlinks.delete(srcPath)
      log('info', 'file.rename.detected', srcPath, `→ ${path.basename(filePath)}`)
      enqueueRename(srcPath, filePath, libraryId)
      return
    }
  }

  // T9: Pre-insert row with server_url=NULL, dirty=1 — makes file visible to crash-recovery
  if (!getByLocalPath(filePath)) {
    try {
      const stat = fs.statSync(filePath)
      insertSyncItem({
        server_url: null,
        local_path: filePath,
        sp_item_id: null,
        etag: null,
        sp_version: null,
        last_synced_at: null,
        local_mtime: stat.mtimeMs,
        local_size: stat.size,
        dirty: 1,
        permission_level: 'rw',
      })
    } catch { /* file may have vanished already */ }
  }

  enqueueUpload(filePath, libraryId)
}

function onChange(filePath: string, libraryId: number): void {
  if (consumeSuppressedLocalWrite(filePath)) return
  if (isCleanSyncedFile(filePath)) return
  try { markDirty(filePath) } catch { /* item may not exist yet */ }
  enqueueUpload(filePath, libraryId)
}

function onUnlink(filePath: string, libraryId: number): void {
  // T2: Record unlink; if a matching add arrives within RENAME_WINDOW_MS, treat as rename
  recentUnlinks.set(filePath, { time: Date.now(), libraryId })

  setTimeout(() => {
    if (recentUnlinks.has(filePath)) {
      recentUnlinks.delete(filePath)
      enqueueDelete(filePath, libraryId)
    }
  }, RENAME_WINDOW_MS + 50)
}

function onAddDir(dirPath: string, libraryId: number): void {
  // Create the SP folder before any files inside it are uploaded
  enqueueMkdir(dirPath, libraryId)
}

function isCleanSyncedFile(filePath: string): boolean {
  const existing = getByLocalPath(filePath)
  if (!existing || existing.dirty !== 0) return false

  try {
    const stat = fs.statSync(filePath)
    return existing.local_size === stat.size &&
      existing.local_mtime != null &&
      Math.abs(existing.local_mtime - stat.mtimeMs) < 2
  } catch {
    return false
  }
}
