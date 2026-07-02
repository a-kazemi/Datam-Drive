import path from 'path'
import fs from 'fs'
import os from 'os'
import { downloadFile, uploadFile } from '../sp-client/operations'
import { upsertSyncItem, SyncItemRow } from '../db/sync-items'
import { LibraryRow } from '../db/libraries'
import { log } from '../logger'

export type NotifyFn = (msg: string) => void
let notifyUser: NotifyFn = () => {}

export function setNotifyFn(fn: NotifyFn): void {
  notifyUser = fn
}

// T7: Step order is critical — rename local FIRST so user's edits survive any subsequent crash
export async function resolveConflict(
  lib: LibraryRow,
  serverUrl: string,
  localPath: string,
  existing: SyncItemRow
): Promise<void> {
  const username = process.env.USERNAME ?? os.userInfo().username
  const date = new Date().toISOString().slice(0, 10)
  const conflictLocalPath = makeConflictPath(localPath, username, date)
  const conflictServerUrl = makeConflictServerUrl(serverUrl, username, date)

  log('info', 'conflict.detected', serverUrl, 'Local + remote both changed')

  // STEP 1: Rename local copy FIRST — user's edits are safe before we touch the original
  fs.renameSync(localPath, conflictLocalPath)
  log('info', 'conflict.renamed', localPath, `→ ${path.basename(conflictLocalPath)}`)

  // STEP 2: Download remote version to original filename
  const { etag, mtime, size } = await downloadFile(lib.site_url, serverUrl, localPath)
  log('info', 'conflict.remote-downloaded', serverUrl, `→ ${path.basename(localPath)}`)

  // STEP 3: Upload the conflict copy to SharePoint
  const { spItemId: cId, etag: cEtag, spVersion: cVer } = await uploadFile(
    lib.site_url, conflictServerUrl, conflictLocalPath
  )
  log('info', 'conflict.local-uploaded', conflictServerUrl, `← ${path.basename(conflictLocalPath)}`)

  // STEP 4: Record both in sync_items
  upsertSyncItem({
    server_url: serverUrl,
    local_path: localPath,
    sp_item_id: existing.sp_item_id,
    etag,
    sp_version: existing.sp_version,
    last_synced_at: Date.now(),
    local_mtime: mtime,
    local_size: size,
    dirty: 0,
    permission_level: existing.permission_level,
  })

  const cStat = fs.statSync(conflictLocalPath)
  upsertSyncItem({
    server_url: conflictServerUrl,
    local_path: conflictLocalPath,
    sp_item_id: cId,
    etag: cEtag,
    sp_version: cVer,
    last_synced_at: Date.now(),
    local_mtime: cStat.mtimeMs,
    local_size: cStat.size,
    dirty: 0,
    permission_level: existing.permission_level,
  })

  // STEP 5: Notify user
  notifyUser(`Conflict in ${path.basename(localPath)} — both copies saved.`)
  log('info', 'conflict.resolved', serverUrl, 'Both copies saved — no data lost')
}

function makeConflictPath(localPath: string, username: string, date: string): string {
  const dir = path.dirname(localPath)
  const ext = path.extname(localPath)
  const base = path.basename(localPath, ext)
  return path.join(dir, `${base} (conflict — ${username} — ${date})${ext}`)
}

function makeConflictServerUrl(serverUrl: string, username: string, date: string): string {
  const slash = serverUrl.lastIndexOf('/')
  const dir = serverUrl.slice(0, slash)
  const filename = serverUrl.slice(slash + 1)
  const dot = filename.lastIndexOf('.')
  const base = dot !== -1 ? filename.slice(0, dot) : filename
  const ext  = dot !== -1 ? filename.slice(dot) : ''
  return `${dir}/${base} (conflict — ${username} — ${date})${ext}`
}
