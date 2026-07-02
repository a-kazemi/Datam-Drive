import { spFetch, SpNotFoundError } from './index'
import { log } from '../logger'
import { suppressLocalWrite } from '../watcher/suppression'
import fs from 'fs'
import path from 'path'

export interface SpWeb {
  Id: string
  Title: string
  ServerRelativeUrl: string
  Url: string
}

export interface SpList {
  Id: string
  Title: string
  BaseTemplate: number
  RootFolder: { ServerRelativeUrl: string }
}

export interface SpListItem {
  Id: number
  FileLeafRef: string
  FileRef: string
  FSObjType: number   // 0=file, 1=folder
  Modified: string
  OData__UIVersionString: string
  File?: { ETag: string; Length: string }
}

export interface EffectivePermissions {
  Low: number
  High: number
}

export interface SpChange {
  ChangeType: number  // 1=Add 2=Update 3=Delete 4=Rename
  ItemId: number
  ServerRelativeUrl?: string
}

const SP_PERM_VIEW  = 0x0000000000000001n
const SP_PERM_ADD   = 0x0000000000000002n
const SP_PERM_EDIT  = 0x0000000000000004n

export function parsePermissions(p: EffectivePermissions): 'rw' | 'ro' | 'hidden' {
  const val = (BigInt(p.High) << 32n) | BigInt(p.Low)
  if (!(val & SP_PERM_VIEW)) return 'hidden'
  if ((val & SP_PERM_ADD) || (val & SP_PERM_EDIT)) return 'rw'
  return 'ro'
}

export async function getDocumentLibraries(siteUrl: string): Promise<SpList[]> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(
    `${base}/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false` +
    `&$select=Id,Title,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder`
  )
  if (!resp.ok) throw new Error(`getDocumentLibraries: HTTP ${resp.status}`)
  return ((await resp.json() as { value: SpList[] }).value)
}

export async function getEffectivePermissions(siteUrl: string, listId: string): Promise<EffectivePermissions> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(`${base}/_api/web/lists('${listId}')/EffectiveBasePermissions`)
  if (!resp.ok) throw new Error(`getEffectivePermissions: HTTP ${resp.status}`)
  const d = await resp.json() as { Low: string; High: string }
  return { Low: parseInt(d.Low), High: parseInt(d.High) }
}

export async function getCurrentChangeToken(siteUrl: string, listId: string): Promise<string> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(`${base}/_api/web/lists('${listId}')/CurrentChangeToken`)
  if (!resp.ok) throw new Error(`getCurrentChangeToken: HTTP ${resp.status}`)
  return ((await resp.json() as { StringValue: string }).StringValue)
}

export class StaleChangeTokenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'StaleChangeTokenError' }
}

export async function getChanges(
  siteUrl: string, listId: string, changeToken: string
): Promise<{ changes: SpChange[]; nextToken: string }> {
  const base = siteUrl.replace(/\/$/, '')
  const body = JSON.stringify({
    query: {
      ChangeTokenStart: { StringValue: changeToken },
      Add: true, Update: true, DeleteObject: true, Rename: true,
      Item: true, File: true, Folder: true,
    },
  })

  const resp = await spFetch(`${base}/_api/web/lists('${listId}')/GetChanges`, { method: 'POST', body })
  if (!resp.ok) {
    const text = await resp.text()
    // T1: Detect stale token to trigger transparent re-enumerate
    if (resp.status === 400 || text.toLowerCase().includes('token')) {
      throw new StaleChangeTokenError('Change token expired')
    }
    throw new Error(`getChanges: HTTP ${resp.status}`)
  }

  const data = await resp.json() as { value: SpChange[] }
  const nextToken = await getCurrentChangeToken(siteUrl, listId)
  return { changes: data.value, nextToken }
}

export interface SpItemPage {
  items: SpListItem[]
  nextSkipToken: string | null
}

export async function getListItems(siteUrl: string, listId: string, skipToken?: string): Promise<SpItemPage> {
  const base = siteUrl.replace(/\/$/, '')
  const sel = '$select=Id,FileLeafRef,FileRef,FSObjType,Modified,OData__UIVersionString,File/ETag,File/Length&$expand=File'
  const skip = skipToken ? `&$skiptoken=${encodeURIComponent(skipToken)}` : ''
  const resp = await spFetch(`${base}/_api/web/lists('${listId}')/items?${sel}&$top=1000${skip}`)
  if (!resp.ok) throw new Error(`getListItems: HTTP ${resp.status}`)

  const data = await resp.json() as { value: SpListItem[]; 'odata.nextLink'?: string }
  let nextSkipToken: string | null = null
  const next = data['odata.nextLink']
  if (next) {
    const m = next.match(/\$skiptoken=([^&]+)/)
    if (m) nextSkipToken = decodeURIComponent(m[1])
  }
  return { items: data.value, nextSkipToken }
}

export async function getListItemById(siteUrl: string, listId: string, itemId: number): Promise<SpListItem | null> {
  const base = siteUrl.replace(/\/$/, '')
  const sel = '$select=Id,FileLeafRef,FileRef,FSObjType,Modified,OData__UIVersionString,File/ETag,File/Length&$expand=File'
  const resp = await spFetch(`${base}/_api/web/lists('${listId}')/items(${itemId})?${sel}`)
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`getListItemById: HTTP ${resp.status}`)

  return await resp.json() as SpListItem
}

export async function downloadFile(
  siteUrl: string, serverRelativeUrl: string, localPath: string
): Promise<{ etag: string; mtime: number; size: number }> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(
    `${base}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent(serverRelativeUrl)}')/$value`,
    { headers: { Accept: 'application/octet-stream' } }
  )
  if (!resp.ok) throw new Error(`downloadFile: HTTP ${resp.status} — ${serverRelativeUrl}`)

  fs.mkdirSync(path.dirname(localPath), { recursive: true })
  const buf = await resp.buffer()
  suppressLocalWrite(localPath)
  fs.writeFileSync(localPath, buf)

  const stat = fs.statSync(localPath)
  log('info', 'file.downloaded', serverRelativeUrl, `→ ${localPath}`)
  return { etag: resp.headers.get('ETag') ?? '', mtime: stat.mtimeMs, size: stat.size }
}

export async function uploadFile(
  siteUrl: string, serverRelativeUrl: string, localPath: string
): Promise<{ spItemId: number; etag: string; spVersion: number }> {
  const base = siteUrl.replace(/\/$/, '')
  const lastSlash = serverRelativeUrl.lastIndexOf('/')
  const folderUrl = serverRelativeUrl.slice(0, lastSlash)
  const filename = encodeURIComponent(serverRelativeUrl.slice(lastSlash + 1))

  const content = fs.readFileSync(localPath)
  const url = `${base}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(folderUrl)}')/Files/add(url='${filename}',overwrite=true)`

  const resp = await spFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  })
  if (!resp.ok) throw new Error(`uploadFile: HTTP ${resp.status} — ${serverRelativeUrl}`)

  const data = await resp.json() as { ListItemAllFields?: { Id?: number; _UIVersionString?: string }; ETag?: string }
  const spItemId = data.ListItemAllFields?.Id ?? 0
  const spVersion = parseInt(data.ListItemAllFields?._UIVersionString ?? '1') || 1
  const etag = data.ETag ?? ''

  log('info', 'file.uploaded', serverRelativeUrl, `← ${localPath} (v${spVersion})`)
  return { spItemId, etag, spVersion }
}

export async function createFolder(siteUrl: string, serverRelativeUrl: string): Promise<void> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(`${base}/_api/web/folders`, {
    method: 'POST',
    body: JSON.stringify({ ServerRelativeUrl: serverRelativeUrl }),
  })
  if (!resp.ok && resp.status !== 409) throw new Error(`createFolder: HTTP ${resp.status}`)
  log('info', 'folder.created', serverRelativeUrl, '')
}

export async function moveFile(siteUrl: string, srcUrl: string, dstUrl: string): Promise<void> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(
    `${base}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent(srcUrl)}')/MoveTo(newUrl='${encodeURIComponent(dstUrl)}',flags=1)`,
    { method: 'POST' }
  )
  if (!resp.ok) throw new Error(`moveFile: HTTP ${resp.status}`)
  log('info', 'file.renamed', srcUrl, `→ ${dstUrl}`)
}

export async function recycleFile(siteUrl: string, spItemId: number, listId: string): Promise<void> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(
    `${base}/_api/web/lists('${listId}')/items(${spItemId})/recycle()`,
    { method: 'POST' }
  )
  if (resp.status === 404) {
    log('info', 'file.deleted.already', String(spItemId), 'Already deleted remotely')
    return
  }
  if (!resp.ok) throw new Error(`recycleFile: HTTP ${resp.status}`)
  log('info', 'recycle.sent', String(spItemId), '→ SP Recycle Bin')
}

export async function resolveItemId(siteUrl: string, serverRelativeUrl: string): Promise<number | null> {
  const base = siteUrl.replace(/\/$/, '')
  const resp = await spFetch(
    `${base}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent(serverRelativeUrl)}')/ListItemAllFields/Id`
  )
  if (resp.status === 404) return null
  if (!resp.ok) throw new Error(`resolveItemId: HTTP ${resp.status}`)
  return ((await resp.json() as { value: number }).value)
}
