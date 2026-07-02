import { getDb } from './schema'

export interface LibraryRow {
  id: number
  site_url: string
  list_id: string
  title: string
  local_root: string
  change_token: string | null
  last_polled: number | null
  permission_level: string
  status: string
}

export function addLibrary(lib: Omit<LibraryRow, 'id' | 'change_token' | 'last_polled' | 'status'>): number {
  const r = getDb().prepare(`
    INSERT INTO libraries (site_url, list_id, title, local_root, permission_level)
    VALUES (@site_url, @list_id, @title, @local_root, @permission_level)
  `).run(lib)
  return r.lastInsertRowid as number
}

export function getAllLibraries(): LibraryRow[] {
  return getDb().prepare('SELECT * FROM libraries').all() as LibraryRow[]
}

export function getLibraryById(id: number): LibraryRow | undefined {
  return getDb().prepare('SELECT * FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined
}

export function removeLibrary(id: number): void {
  getDb().prepare('DELETE FROM libraries WHERE id = ?').run(id)
}

export function updateChangeToken(id: number, token: string): void {
  getDb().prepare(
    'UPDATE libraries SET change_token = ?, last_polled = ? WHERE id = ?'
  ).run(token, Date.now(), id)
}

export function resetChangeToken(id: number): void {
  getDb().prepare('UPDATE libraries SET change_token = NULL WHERE id = ?').run(id)
}

export function updateStatus(id: number, status: string): void {
  getDb().prepare('UPDATE libraries SET status = ? WHERE id = ?').run(status, id)
}

export function updatePermissionLevel(id: number, level: string): void {
  getDb().prepare('UPDATE libraries SET permission_level = ? WHERE id = ?').run(level, id)
}

export function localRootInUse(localRoot: string): boolean {
  return getDb().prepare('SELECT id FROM libraries WHERE local_root = ?').get(localRoot) != null
}
