import { getCurrentChangeToken, getListItems, downloadFile, SpListItem } from '../sp-client/operations'
import { upsertSyncItem } from '../db/sync-items'
import { updateChangeToken } from '../db/libraries'
import { log } from '../logger'
import path from 'path'
import fs from 'fs'

// T8: Enumerate-then-CurrentChangeToken — never GetChanges(null) which is version-dependent
export async function runInitialSync(
  libraryId: number,
  siteUrl: string,
  listId: string,
  localRoot: string,
  libraryRootServerUrl: string
): Promise<string> {
  log('info', 'initial-sync.start', listId, `Enumerating ${listId}`)

  // Capture token BEFORE enumeration — catches changes that arrive during the scan
  const pendingToken = await getCurrentChangeToken(siteUrl, listId)

  let skipToken: string | undefined
  let page = 0

  do {
    const { items, nextSkipToken } = await getListItems(siteUrl, listId, skipToken)
    skipToken = nextSkipToken ?? undefined
    page++

    for (const item of items) {
      await processInitialItem(item, siteUrl, localRoot, libraryRootServerUrl)
    }

    log('info', 'initial-sync.page', listId, `Page ${page}: ${items.length} items`)
  } while (skipToken)

  updateChangeToken(libraryId, pendingToken)
  log('info', 'initial-sync.complete', listId, `Done — delta poll begins`)
  return pendingToken
}

async function processInitialItem(
  item: SpListItem,
  siteUrl: string,
  localRoot: string,
  libraryRootServerUrl: string
): Promise<void> {
  const localPath = serverUrlToLocalPath(item.FileRef, libraryRootServerUrl, localRoot)

  if (item.FSObjType === 1) {
    fs.mkdirSync(localPath, { recursive: true })
    return
  }

  const etag = item.File?.ETag ?? ''
  const spVersion = parseInt(item.OData__UIVersionString ?? '1') || 1
  // No conflict possible on initial sync — download unconditionally
  const { mtime, size } = await downloadFile(siteUrl, item.FileRef, localPath)

  upsertSyncItem({
    server_url: item.FileRef,
    local_path: localPath,
    sp_item_id: item.Id,
    etag,
    sp_version: spVersion,
    last_synced_at: Date.now(),
    local_mtime: mtime,
    local_size: size,
    dirty: 0,
    permission_level: 'rw',
  })
}

export function serverUrlToLocalPath(
  serverUrl: string,
  libraryRootServerUrl: string,
  localRoot: string
): string {
  const normalizedRoot = libraryRootServerUrl.replace(/\/$/, '').toLowerCase()
  const normalizedServer = serverUrl.toLowerCase()
  let relative = serverUrl

  if (normalizedServer === normalizedRoot) {
    relative = ''
  } else if (normalizedServer.startsWith(`${normalizedRoot}/`)) {
    relative = serverUrl.slice(libraryRootServerUrl.replace(/\/$/, '').length + 1)
  } else {
    relative = path.posix.basename(serverUrl)
  }

  const rest = relative.split('/').filter(Boolean).join(path.sep)
  return path.join(localRoot, rest)
}

export function localPathToServerUrl(
  localPath: string,
  localRoot: string,
  libraryRootServerUrl: string
): string {
  const relative = path.relative(localRoot, localPath).split(path.sep).join('/')
  return relative
    ? `${libraryRootServerUrl.replace(/\/$/, '')}/${relative}`
    : libraryRootServerUrl.replace(/\/$/, '')
}
