import { getDb } from './schema'

export interface SyncItemRow {
  id: number
  server_url: string | null
  local_path: string
  sp_item_id: number | null
  etag: string | null
  sp_version: number | null
  last_synced_at: number | null
  local_mtime: number | null
  local_size: number | null
  dirty: number
  permission_level: string
}

export function insertSyncItem(item: Omit<SyncItemRow, 'id'>): number {
  const r = getDb().prepare(`
    INSERT INTO sync_items
      (server_url, local_path, sp_item_id, etag, sp_version,
       last_synced_at, local_mtime, local_size, dirty, permission_level)
    VALUES
      (@server_url, @local_path, @sp_item_id, @etag, @sp_version,
       @last_synced_at, @local_mtime, @local_size, @dirty, @permission_level)
  `).run(item)
  return r.lastInsertRowid as number
}

export function upsertSyncItem(item: Omit<SyncItemRow, 'id'>): void {
  getDb().prepare(`
    INSERT INTO sync_items
      (server_url, local_path, sp_item_id, etag, sp_version,
       last_synced_at, local_mtime, local_size, dirty, permission_level)
    VALUES
      (@server_url, @local_path, @sp_item_id, @etag, @sp_version,
       @last_synced_at, @local_mtime, @local_size, @dirty, @permission_level)
    ON CONFLICT(local_path) DO UPDATE SET
      server_url       = excluded.server_url,
      sp_item_id       = excluded.sp_item_id,
      etag             = excluded.etag,
      sp_version       = excluded.sp_version,
      last_synced_at   = excluded.last_synced_at,
      local_mtime      = excluded.local_mtime,
      local_size       = excluded.local_size,
      dirty            = excluded.dirty,
      permission_level = excluded.permission_level
  `).run(item)
}

export function updateSyncItemAfterUpload(
  localPath: string, serverUrl: string, spItemId: number,
  etag: string, spVersion: number, localMtime: number, localSize: number
): void {
  getDb().prepare(`
    UPDATE sync_items SET
      server_url = ?, sp_item_id = ?, etag = ?, sp_version = ?,
      last_synced_at = ?, local_mtime = ?, local_size = ?, dirty = 0
    WHERE local_path = ?
  `).run(serverUrl, spItemId, etag, spVersion, Date.now(), localMtime, localSize, localPath)
}

export function markDirty(localPath: string): void {
  getDb().prepare('UPDATE sync_items SET dirty = 1 WHERE local_path = ?').run(localPath)
}

export function getDirtyItems(): SyncItemRow[] {
  return getDb().prepare('SELECT * FROM sync_items WHERE dirty = 1').all() as SyncItemRow[]
}

export function getByLocalPath(localPath: string): SyncItemRow | undefined {
  return getDb().prepare('SELECT * FROM sync_items WHERE local_path = ?').get(localPath) as SyncItemRow | undefined
}

export function getByServerUrl(serverUrl: string): SyncItemRow | undefined {
  return getDb().prepare('SELECT * FROM sync_items WHERE server_url = ?').get(serverUrl) as SyncItemRow | undefined
}

export function deleteByLocalPath(localPath: string): void {
  getDb().prepare('DELETE FROM sync_items WHERE local_path = ?').run(localPath)
}

export function updatePermissionLevel(serverUrl: string, level: string): void {
  getDb().prepare('UPDATE sync_items SET permission_level = ? WHERE server_url = ?').run(level, serverUrl)
}
