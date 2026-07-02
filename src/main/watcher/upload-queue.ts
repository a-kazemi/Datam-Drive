import { uploadFile, createFolder, moveFile, recycleFile, resolveItemId } from '../sp-client/operations'
import {
  getByLocalPath, insertSyncItem, updateSyncItemAfterUpload,
  deleteByLocalPath, SyncItemRow,
} from '../db/sync-items'
import { getLibraryById, LibraryRow } from '../db/libraries'
import { getAllSettings } from '../db/settings'
import { log } from '../logger'
import { localPathToServerUrl } from '../poller/initial-sync'
import path from 'path'
import fs from 'fs'
import { URL } from 'url'

export type NotifyFn = (msg: string) => void
let notifyUser: NotifyFn = () => {}
export function setNotifyFn(fn: NotifyFn): void { notifyUser = fn }

interface Task {
  localPath: string
  libraryId: number
  type: 'upload' | 'delete' | 'mkdir'
  srcPath?: string
}

const queue: Task[] = []
let processing = false

export function enqueueUpload(localPath: string, libraryId: number): void {
  if (!queue.some(t => t.localPath === localPath && t.type === 'upload')) {
    queue.push({ localPath, libraryId, type: 'upload' })
    processQueue()
  }
}

export function enqueueDelete(localPath: string, libraryId: number): void {
  queue.push({ localPath, libraryId, type: 'delete' })
  processQueue()
}

export function enqueueMkdir(localPath: string, libraryId: number): void {
  queue.push({ localPath, libraryId, type: 'mkdir' })
  processQueue()
}

export function enqueueRename(srcPath: string, dstPath: string, libraryId: number): void {
  queue.push({ localPath: dstPath, libraryId, type: 'upload', srcPath })
  processQueue()
}

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  while (queue.length > 0) {
    const task = queue.shift()!
    try { await runTask(task) }
    catch (err) { log('error', 'upload.error', task.localPath, String(err)) }
  }
  processing = false
}

async function runTask(task: Task): Promise<void> {
  const lib = getLibraryById(task.libraryId)
  if (!lib) return

  if (task.type === 'mkdir') { await handleMkdir(task.localPath, lib); return }
  if (task.type === 'delete') { await handleDelete(task.localPath, lib); return }
  if (task.srcPath) { await handleRename(task.srcPath, task.localPath, lib) }
  else { await handleUpload(task.localPath, lib) }
}

async function handleUpload(localPath: string, lib: LibraryRow): Promise<void> {
  if (lib.permission_level === 'ro') {
    notifyUser(`${path.basename(localPath)} was not uploaded — you don't have write access.`)
    log('warn', 'upload.blocked', localPath, 'permission: ro')
    return
  }

  // T12: Pre-upload size guard
  const { maxFileSizeBytes } = getAllSettings()
  let stat: fs.Stats
  try { stat = fs.statSync(localPath) } catch { return }

  if (stat.size > maxFileSizeBytes) {
    const mb = (stat.size / 1024 / 1024).toFixed(1)
    const maxMb = (maxFileSizeBytes / 1024 / 1024).toFixed(0)
    notifyUser(`${path.basename(localPath)} is too large to sync (${mb} MB > ${maxMb} MB limit). File is safe locally.`)
    log('warn', 'upload.too-large', localPath, `size ${stat.size} > max ${maxFileSizeBytes}`)
    return
  }

  const existing = getByLocalPath(localPath)
  const serverUrl = existing?.server_url ?? deriveServerUrl(localPath, lib)

  const { spItemId, etag, spVersion } = await uploadFile(lib.site_url, serverUrl, localPath)
  const finalStat = fs.statSync(localPath)
  updateSyncItemAfterUpload(localPath, serverUrl, spItemId, etag, spVersion, finalStat.mtimeMs, finalStat.size)
}

async function handleDelete(localPath: string, lib: LibraryRow): Promise<void> {
  const existing = getByLocalPath(localPath)
  if (!existing) return

  let spItemId = existing.sp_item_id
  if (!spItemId && existing.server_url) {
    spItemId = await resolveItemId(lib.site_url, existing.server_url) ?? null
  }

  if (!spItemId) {
    log('info', 'delete.no-item-id', localPath, 'Skipping recycle')
    deleteByLocalPath(localPath)
    return
  }

  await recycleFile(lib.site_url, spItemId, lib.list_id)
  deleteByLocalPath(localPath)
}

async function handleRename(srcPath: string, dstPath: string, lib: LibraryRow): Promise<void> {
  const existing = getByLocalPath(srcPath)
  if (!existing?.server_url) { await handleUpload(dstPath, lib); return }

  const dstServerUrl = deriveServerUrl(dstPath, lib)
  await moveFile(lib.site_url, existing.server_url, dstServerUrl)

  deleteByLocalPath(srcPath)
  const stat = fs.statSync(dstPath)
  insertSyncItem({
    server_url: dstServerUrl,
    local_path: dstPath,
    sp_item_id: existing.sp_item_id,
    etag: existing.etag,
    sp_version: existing.sp_version,
    last_synced_at: Date.now(),
    local_mtime: stat.mtimeMs,
    local_size: stat.size,
    dirty: 0,
    permission_level: existing.permission_level,
  })
}

async function handleMkdir(localPath: string, lib: LibraryRow): Promise<void> {
  const serverUrl = deriveServerUrl(localPath, lib)
  await createFolder(lib.site_url, serverUrl)
}

function deriveServerUrl(localPath: string, lib: LibraryRow): string {
  const sitePath = new URL(lib.site_url).pathname.replace(/\/$/, '')
  const relative = path.relative(lib.local_root, localPath).split(path.sep).join('/')
  return `${sitePath}/${lib.title}/${relative}`
}
