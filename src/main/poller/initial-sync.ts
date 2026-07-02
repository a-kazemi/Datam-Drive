import { getCurrentChangeToken, getListItems, downloadFile, SpListItem } from '../sp-client/operations'
import { upsertSyncItem } from '../db/sync-items'
import { updateChangeToken } from '../db/libraries'
import { log } from '../logger'
import path from 'path'
import fs from 'fs'
import { URL } from 'url'

// T8: Enumerate-then-CurrentChangeToken — never GetChanges(null) which is version-dependent
export async function runInitialSync(
  libraryId: number,
  siteUrl: string,
  listId: string,
  localRoot: string,
  libraryFolderName: string
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
      await processInitialItem(item, siteUrl, localRoot, libraryFolderName)
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
  libraryFolderName: string
): Promise<void> {
  const localPath = serverUrlToLocalPath(item.FileRef, siteUrl, localRoot, libraryFolderName)

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
  siteUrl: string,
  localRoot: string,
  libraryFolderName: string
): string {
  // Strip SP site base + library folder name to get file-relative path
  const sitePath = new URL(siteUrl).pathname.replace(/\/$/, '')
  let relative = serverUrl.startsWith(sitePath) ? serverUrl.slice(sitePath.length) : serverUrl
  relative = relative.replace(/^\//, '')  // remove leading slash
  // relative is now "LibraryFolder/subdir/file.ext"; strip the library folder
  const segments = relative.split('/')
  const rest = segments.slice(1).join(path.sep)
  return path.join(localRoot, rest)
}

export function localPathToServerUrl(
  localPath: string,
  localRoot: string,
  siteUrl: string,
  libraryFolderName: string
): string {
  const sitePath = new URL(siteUrl).pathname.replace(/\/$/, '')
  const relative = path.relative(localRoot, localPath).split(path.sep).join('/')
  return `${sitePath}/${libraryFolderName}/${relative}`
}
