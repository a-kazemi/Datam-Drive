import { startLibraryPoll, stopLibraryPoll } from '../poller'
import { startWatcher, stopWatcher } from '../watcher'
import { addLibrary, removeLibrary, getAllLibraries, localRootInUse } from '../db/libraries'
import { deleteByLocalRoot } from '../db/sync-items'
import { getEffectivePermissions, getListRootFolderUrl, parsePermissions, getDocumentLibraries, SpList } from '../sp-client/operations'
import { log } from '../logger'
import fs from 'fs'
import path from 'path'

export interface AddLibraryRequest {
  siteUrl: string
  listId: string
  title: string
  rootFolderUrl?: string
  localRoot?: string
  syncParentRoot?: string
}

function toSafeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '') || 'Library'
}

function nextAvailableLocalRoot(parentRoot: string, folderName: string): string {
  const base = path.join(parentRoot, folderName)
  let candidate = base
  let suffix = 1

  while (fs.existsSync(candidate) || localRootInUse(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }

  return candidate
}

export async function mountLibrary(
  req: AddLibraryRequest
): Promise<{ id: number; error?: string }> {
  const localRoot = req.syncParentRoot
    ? nextAvailableLocalRoot(req.syncParentRoot, toSafeFolderName(req.title))
    : req.localRoot

  if (!localRoot) {
    return { id: -1, error: 'Choose a local sync folder.' }
  }

  // T13: UX-layer check before the DB UNIQUE constraint fires
  if (localRootInUse(localRoot)) {
    return { id: -1, error: `The folder "${localRoot}" is already used by another library.` }
  }

  // Warn if the path looks like a network share
  if (localRoot.startsWith('\\\\')) {
    log('warn', 'library.network-path', localRoot, 'UNC paths may not work reliably with chokidar')
  }

  const perms = await getEffectivePermissions(req.siteUrl, req.listId)
  const permLevel = parsePermissions(perms)

  if (permLevel === 'hidden') {
    return { id: -1, error: 'You do not have permission to access this library.' }
  }

  fs.mkdirSync(localRoot, { recursive: true })
  const rootFolderUrl = req.rootFolderUrl ?? await getListRootFolderUrl(req.siteUrl, req.listId)

  const id = addLibrary({
    site_url: req.siteUrl,
    list_id: req.listId,
    title: req.title,
    root_folder_url: rootFolderUrl,
    local_root: localRoot,
    permission_level: permLevel,
  })

  log('info', 'library.mounted', req.title, `id=${id} perm=${permLevel}`)
  startWatcher(id, localRoot)
  startLibraryPoll(id)

  return { id }
}

export function unmountLibrary(id: number): void {
  const lib = getAllLibraries().find(l => l.id === id)
  stopLibraryPoll(id)
  stopWatcher(id)
  if (lib) deleteByLocalRoot(lib.local_root)
  removeLibrary(id)
  log('info', 'library.unmounted', String(id), '')
}

export async function enumerateLibraries(siteUrl: string): Promise<SpList[]> {
  return getDocumentLibraries(siteUrl)
}
