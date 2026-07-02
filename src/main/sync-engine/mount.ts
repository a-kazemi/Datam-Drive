import { startLibraryPoll, stopLibraryPoll } from '../poller'
import { startWatcher, stopWatcher } from '../watcher'
import { addLibrary, removeLibrary, getAllLibraries, localRootInUse } from '../db/libraries'
import { getEffectivePermissions, parsePermissions, getDocumentLibraries, SpList } from '../sp-client/operations'
import { log } from '../logger'
import fs from 'fs'

export interface AddLibraryRequest {
  siteUrl: string
  listId: string
  title: string
  localRoot: string
}

export async function mountLibrary(
  req: AddLibraryRequest
): Promise<{ id: number; error?: string }> {
  // T13: UX-layer check before the DB UNIQUE constraint fires
  if (localRootInUse(req.localRoot)) {
    return { id: -1, error: `The folder "${req.localRoot}" is already used by another library.` }
  }

  // Warn if the path looks like a network share
  if (req.localRoot.startsWith('\\\\')) {
    log('warn', 'library.network-path', req.localRoot, 'UNC paths may not work reliably with chokidar')
  }

  const perms = await getEffectivePermissions(req.siteUrl, req.listId)
  const permLevel = parsePermissions(perms)

  if (permLevel === 'hidden') {
    return { id: -1, error: 'You do not have permission to access this library.' }
  }

  fs.mkdirSync(req.localRoot, { recursive: true })

  const id = addLibrary({
    site_url: req.siteUrl,
    list_id: req.listId,
    title: req.title,
    local_root: req.localRoot,
    permission_level: permLevel,
  })

  log('info', 'library.mounted', req.title, `id=${id} perm=${permLevel}`)
  startWatcher(id, req.localRoot)
  startLibraryPoll(id)

  return { id }
}

export function unmountLibrary(id: number): void {
  stopLibraryPoll(id)
  stopWatcher(id)
  removeLibrary(id)
  log('info', 'library.unmounted', String(id), '')
}

export async function enumerateLibraries(siteUrl: string): Promise<SpList[]> {
  return getDocumentLibraries(siteUrl)
}
