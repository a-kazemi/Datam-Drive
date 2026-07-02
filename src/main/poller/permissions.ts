import { getEffectivePermissions, parsePermissions } from '../sp-client/operations'
import { getAllLibraries, updatePermissionLevel, updateStatus, LibraryRow } from '../db/libraries'
import { log } from '../logger'

// T3: 5-minute permission re-check — not configurable in v1
const RECHECK_INTERVAL_MS = 5 * 60 * 1000

export type PermissionChangedHandler = (lib: LibraryRow, newLevel: 'rw' | 'ro' | 'hidden') => void

let recheckTimer: ReturnType<typeof setInterval> | null = null
let onPermissionChanged: PermissionChangedHandler | null = null

export function startPermissionRecheck(handler: PermissionChangedHandler): void {
  onPermissionChanged = handler
  recheckTimer = setInterval(recheckAllPermissions, RECHECK_INTERVAL_MS)
}

export function stopPermissionRecheck(): void {
  if (recheckTimer) { clearInterval(recheckTimer); recheckTimer = null }
}

export async function recheckAllPermissions(): Promise<void> {
  for (const lib of getAllLibraries()) {
    try {
      await recheckOne(lib)
    } catch (err) {
      log('warn', 'perm.recheck.error', lib.title, String(err))
    }
  }
}

async function recheckOne(lib: LibraryRow): Promise<void> {
  const perms = await getEffectivePermissions(lib.site_url, lib.list_id)
  const newLevel = parsePermissions(perms)
  const current = lib.permission_level as 'rw' | 'ro' | 'hidden'

  log('info', 'perm.recheck', lib.title, `${current} → ${newLevel}`)
  if (newLevel === current) return

  updatePermissionLevel(lib.id, newLevel)
  onPermissionChanged?.(lib, newLevel)

  if (newLevel === 'hidden') {
    updateStatus(lib.id, 'paused')
    log('warn', 'perm.removed', lib.title, 'Access revoked — sync paused')
  } else if (newLevel === 'ro' && current === 'rw') {
    log('warn', 'perm.downgraded', lib.title, 'Downgraded to read-only — uploads blocked')
  } else if (newLevel === 'rw' && current === 'ro') {
    log('info', 'perm.upgraded', lib.title, 'Upgraded to read-write — uploads enabled')
  }
}
