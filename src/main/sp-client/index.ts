import fetch, { RequestInit, Response } from 'node-fetch'
import { getAuthRequestOptions, reauthenticate, getCurrentAuth } from '../auth'
import { log } from '../logger'

const MAX_TRANSIENT_RETRIES = 5
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 5 * 60 * 1000
const DIGEST_SAFETY_WINDOW_MS = 60_000

interface DigestCacheEntry {
  value: string
  expiresAt: number
}

const digestCache = new Map<string, DigestCacheEntry>()

export async function spFetch(url: string, options: RequestInit = {}, attempt = 0): Promise<Response> {
  const authOptions = await getAuthRequestOptions(url)
  const headers: Record<string, string> = {
    Accept: 'application/json;odata=nometadata',
    'Content-Type': 'application/json',
    ...authOptions.headers,
    ...(options.headers as Record<string, string> ?? {}),
  }

  if (requiresDigest(options.method) && !hasHeader(headers, 'X-RequestDigest')) {
    headers['X-RequestDigest'] = await getRequestDigest(url)
  }

  const resp = await fetch(url, {
    ...options,
    ...(authOptions.agent ? { agent: authOptions.agent } : {}),
    headers,
  })

  // T5: Throttled — honor Retry-After exactly, not exponential backoff
  if (resp.status === 429) {
    const retryAfter = parseRetryAfter(resp.headers.get('Retry-After'))
    log('warn', 'sp.throttled', url, `HTTP 429 — waiting ${retryAfter}ms (Retry-After)`)
    await sleep(retryAfter)
    return spFetch(url, options, attempt)
  }

  // 401 — attempt one silent re-auth
  if (resp.status === 401 && attempt === 0) {
    const auth = getCurrentAuth()
    if (auth) {
      log('warn', 'sp.reauth', url, 'HTTP 401 — silent re-authentication')
      const refreshed = await reauthenticate(auth.siteUrl)
      if (refreshed) return spFetch(url, options, attempt + 1)
    }
    throw new SpAuthError('Authentication failed (HTTP 401)')
  }

  // Transient errors — exponential backoff
  if (isTransient(resp.status) && attempt < MAX_TRANSIENT_RETRIES) {
    const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS)
    log('warn', 'sp.retry.transient', url, `HTTP ${resp.status} — backoff ${delay}ms (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
    await sleep(delay)
    return spFetch(url, options, attempt + 1)
  }

  return resp
}

function isTransient(status: number): boolean {
  return status === 503 || status === 502 || status === 504
}

function requiresDigest(method?: string): boolean {
  const normalized = (method ?? 'GET').toUpperCase()
  return normalized !== 'GET' && normalized !== 'HEAD'
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase())
}

function getWebBaseUrl(apiUrl: string): string {
  const marker = '/_api/'
  const markerIndex = apiUrl.toLowerCase().indexOf(marker)
  if (markerIndex >= 0) return apiUrl.slice(0, markerIndex)

  const parsed = new URL(apiUrl)
  return `${parsed.protocol}//${parsed.host}`
}

async function getRequestDigest(apiUrl: string): Promise<string> {
  const webBase = getWebBaseUrl(apiUrl).replace(/\/$/, '')
  const cached = digestCache.get(webBase)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const contextUrl = `${webBase}/_api/contextinfo`
  const authOptions = await getAuthRequestOptions(contextUrl)
  const resp = await fetch(contextUrl, {
    method: 'POST',
    ...(authOptions.agent ? { agent: authOptions.agent } : {}),
    headers: {
      Accept: 'application/json;odata=nometadata',
      'Content-Type': 'application/json',
      ...authOptions.headers,
    },
  })

  if (!resp.ok) throw new SpAuthError(`Unable to get SharePoint request digest (HTTP ${resp.status})`)

  const data = await resp.json() as {
    FormDigestValue?: string
    FormDigestTimeoutSeconds?: number
    d?: { GetContextWebInformation?: { FormDigestValue?: string; FormDigestTimeoutSeconds?: number } }
  }
  const info = data.d?.GetContextWebInformation
  const value = data.FormDigestValue ?? info?.FormDigestValue
  if (!value) throw new SpAuthError('Unable to get SharePoint request digest')

  const timeoutSeconds = data.FormDigestTimeoutSeconds ?? info?.FormDigestTimeoutSeconds ?? 900
  digestCache.set(webBase, {
    value,
    expiresAt: Date.now() + timeoutSeconds * 1000 - DIGEST_SAFETY_WINDOW_MS,
  })
  return value
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 30_000
  const secs = parseInt(header, 10)
  if (!isNaN(secs)) return secs * 1000
  const date = Date.parse(header)
  if (!isNaN(date)) return Math.max(0, date - Date.now())
  return 30_000
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SpAuthError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SpAuthError' }
}

export class SpNotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SpNotFoundError' }
}
