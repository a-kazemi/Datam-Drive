import { getChanges, getListItemById, getListRootFolderUrl, StaleChangeTokenError, downloadFile, SpListItem } from '../sp-client/operations'
import { getAllLibraries, updateChangeToken, resetChangeToken, updateStatus, LibraryRow } from '../db/libraries'
import { getByServerUrl, upsertSyncItem } from '../db/sync-items'
import { runInitialSync, serverUrlToLocalPath } from './initial-sync'
import { schedulePoll } from './scheduler'
import { startPermissionRecheck, stopPermissionRecheck } from './permissions'
import { getAllSettings } from '../db/settings'
import { log } from '../logger'
import fs from 'fs'

let polling = false
const pollLoops = new Set<number>()
const pendingPollDelays = new Map<ReturnType<typeof setTimeout>, () => void>()

export function startPolling(): void {
  if (polling) return
  polling = true

  startPermissionRecheck((lib, level) => {
    log('warn', 'perm.changed', lib.title, `→ ${level}`)
    // Notify renderer via IPC (wired in ipc.ts via event)
    emitLibraryChanged?.()
  })

  for (const lib of getAllLibraries()) {
    startLibraryPoll(lib.id)
  }
}

export function stopPolling(): void {
  polling = false
  pollLoops.clear()
  for (const [timer, resolve] of pendingPollDelays) {
    clearTimeout(timer)
    resolve()
  }
  pendingPollDelays.clear()
  stopPermissionRecheck()
}

export function startLibraryPoll(libraryId: number): void {
  if (pollLoops.has(libraryId)) return
  pollLoops.add(libraryId)
  runLoop(libraryId).catch(err => log('error', 'poll.fatal', String(libraryId), String(err)))
}

export function stopLibraryPoll(libraryId: number): void {
  pollLoops.delete(libraryId)
}

let emitLibraryChanged: (() => void) | null = null

export function setLibraryChangedEmitter(fn: () => void): void {
  emitLibraryChanged = fn
}

async function runLoop(libraryId: number): Promise<void> {
  await waitForPollingDelay(Math.floor(Math.random() * 5000))  // stagger start across libraries

  while (pollLoops.has(libraryId) && polling) {
    const { pollIntervalMs } = getAllSettings()
    try {
      await schedulePoll(() => pollOne(libraryId))
    } catch (err) {
      log('error', 'poll.error', String(libraryId), String(err))
      updateStatus(libraryId, 'error')
    }
    await waitForPollingDelay(pollIntervalMs)
  }
}

function waitForPollingDelay(ms: number): Promise<void> {
  if (!polling) return Promise.resolve()

  return new Promise(resolve => {
    const finish = (): void => {
      pendingPollDelays.delete(timer)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    pendingPollDelays.set(timer, finish)
  })
}

async function pollOne(libraryId: number): Promise<void> {
  const lib = getAllLibraries().find(l => l.id === libraryId)
  if (!lib || lib.status === 'paused') return

  updateStatus(libraryId, 'syncing')
  emitLibraryChanged?.()

  try {
    if (!lib.change_token) {
      // T8: No token → INITIAL ENUMERATE (not GetChanges(null))
      log('info', 'poll.initial', lib.title, 'First sync — enumerating all items')
      const rootFolderUrl = lib.root_folder_url ?? await getListRootFolderUrl(lib.site_url, lib.list_id)
      await runInitialSync(libraryId, lib.site_url, lib.list_id, lib.local_root, rootFolderUrl)
    } else {
      await runDelta(lib)
    }
    updateStatus(libraryId, 'idle')
    emitLibraryChanged?.()
  } catch (err) {
    if (err instanceof StaleChangeTokenError) {
      // T1: Stale token → silent recovery; re-enumerate next tick
      log('warn', 'poll.stale-token', lib.title, 'Token expired — re-enumerating next tick')
      resetChangeToken(libraryId)
      updateStatus(libraryId, 'idle')
    } else {
      throw err
    }
  }
}

async function runDelta(lib: LibraryRow): Promise<void> {
  const { changes, nextToken } = await getChanges(lib.site_url, lib.list_id, lib.change_token!)
  log('info', 'poll.complete', lib.title, `${changes.length} changes`)

  let failedChanges = 0
  for (const change of changes) {
    try {
      await applyChange(lib, change)
    } catch (err) {
      failedChanges++
      log('warn', 'poll.change.error', String(change.ItemId), String(err))
    }
  }

  if (failedChanges > 0) {
    throw new Error(`Failed to apply ${failedChanges} SharePoint change${failedChanges === 1 ? '' : 's'}; token not advanced`)
  }

  updateChangeToken(lib.id, nextToken)
}

async function applyChange(lib: LibraryRow, change: import('../sp-client/operations').SpChange): Promise<void> {
  if (change.ChangeType === 3 && change.ServerRelativeUrl) {
    // Remote delete
    const item = getByServerUrl(change.ServerRelativeUrl)
    if (item) {
      try { if (fs.existsSync(item.local_path)) fs.unlinkSync(item.local_path) } catch {}
      const { deleteByLocalPath } = await import('../db/sync-items')
      deleteByLocalPath(item.local_path)
      log('info', 'file.deleted.remote', change.ServerRelativeUrl, '')
    }
    return
  }

  if (change.ChangeType === 1 || change.ChangeType === 2) {
    const item = await getChangedItem(lib, change)
    if (!item) {
      log('warn', 'poll.change.skipped', String(change.ItemId), 'No item details available')
      return
    }

    const serverUrl = item.FileRef
    const rootFolderUrl = lib.root_folder_url ?? await getListRootFolderUrl(lib.site_url, lib.list_id)
    const localPath = serverUrlToLocalPath(serverUrl, rootFolderUrl, lib.local_root)
    const existing = getByServerUrl(serverUrl)

    if (existing?.dirty === 1) {
      // Conflict: both sides changed
      const { resolveConflict } = await import('../conflict/resolver')
      await resolveConflict(lib, serverUrl, localPath, existing)
      return
    }

    const { etag, mtime, size } = await downloadFile(lib.site_url, serverUrl, localPath)
    upsertSyncItem({
      server_url: serverUrl,
      local_path: localPath,
      sp_item_id: item.Id,
      etag: item.File?.ETag ?? etag,
      sp_version: parseInt(item.OData__UIVersionString ?? '1') || 1,
      last_synced_at: Date.now(),
      local_mtime: mtime,
      local_size: size,
      dirty: 0,
      permission_level: lib.permission_level,
    })
  }
}

async function getChangedItem(
  lib: LibraryRow,
  change: import('../sp-client/operations').SpChange
): Promise<SpListItem | null> {
  if (change.ServerRelativeUrl) {
    return {
      Id: change.ItemId,
      FileLeafRef: '',
      FileRef: change.ServerRelativeUrl,
      FSObjType: 0,
      Modified: '',
      OData__UIVersionString: '1',
    }
  }

  if (!change.ItemId) return null
  return getListItemById(lib.site_url, lib.list_id, change.ItemId)
}
