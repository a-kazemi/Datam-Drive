import { getAuth } from 'node-sp-auth'
import keytar from 'keytar'
import fetch from 'node-fetch'
import os from 'os'
import type { Agent as HttpAgent } from 'http'
import type { Agent as HttpsAgent } from 'https'
import { log } from '../logger'

const KEYTAR_SERVICE = 'DatamDrive'
const KEYTAR_ACCOUNT = 'sharepoint-credentials'

export interface AuthResult {
  headers: Record<string, string>
  agent?: HttpAgent | HttpsAgent
  siteUrl: string
  method: 'sso' | 'credentials'
  username: string
}

let currentAuth: AuthResult | null = null

export function getCurrentAuth(): AuthResult | null {
  return currentAuth
}

function getAuthAgent(authData: Awaited<ReturnType<typeof getAuth>>): HttpAgent | HttpsAgent | undefined {
  return authData.options?.agent as HttpAgent | HttpsAgent | undefined
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin.toLowerCase() === new URL(b).origin.toLowerCase()
  } catch {
    return false
  }
}

async function getStoredCredentialsFor(siteUrl: string): Promise<{ username: string; password: string } | null> {
  const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!stored) return null

  const parsed = JSON.parse(stored) as { siteUrl: string; username: string; password: string }
  if (parsed.siteUrl !== siteUrl && !sameOrigin(parsed.siteUrl, siteUrl)) return null

  return { username: parsed.username, password: parsed.password }
}

async function getStoredCredentials(): Promise<{ siteUrl: string; username: string; password: string } | null> {
  const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)
  if (!stored) return null

  const parsed = JSON.parse(stored) as { siteUrl?: string; username?: string; password?: string }
  if (!parsed.siteUrl || !parsed.username || !parsed.password) return null

  return { siteUrl: parsed.siteUrl, username: parsed.username, password: parsed.password }
}

export async function trySso(siteUrl: string): Promise<AuthResult | null> {
  // Spike A: attempt SSO via SSPI using the current Windows domain session.
  // node-sp-auth with NtmlUserCredentials attempts NTLM with the current process token.
  // If node-sspi is available and the machine is domain-joined, this is zero-credential-stored.
  const domain = process.env.USERDOMAIN ?? os.hostname()
  const username = `${domain}\\${process.env.USERNAME ?? os.userInfo().username}`

  try {
    log('info', 'auth.sso.attempt', siteUrl, `Trying SSO as ${username}`)
    const authData = await getAuth(siteUrl, { username, password: '' })
    const authHeaders = authData.headers as Record<string, string>
    const agent = getAuthAgent(authData)

    await validateAuth(siteUrl, authHeaders, agent)

    currentAuth = { headers: authHeaders, agent, siteUrl, method: 'sso', username }
    log('info', 'auth.sso.success', siteUrl, `Authenticated as ${username}`)
    return currentAuth
  } catch (err) {
    log('warn', 'auth.sso.failed', siteUrl, String(err))
    return null
  }
}

export async function loginWithCredentials(
  siteUrl: string,
  username: string,
  password: string,
  storeInVault = true
): Promise<AuthResult> {
  log('info', 'auth.credentials.attempt', siteUrl, `Authenticating as ${username}`)

  const authData = await getAuth(siteUrl, { username, password })
  const authHeaders = authData.headers as Record<string, string>
  const agent = getAuthAgent(authData)

  await validateAuth(siteUrl, authHeaders, agent)

  if (storeInVault) {
    // Stored in Windows Credential Manager via DPAPI — never plaintext on disk
    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify({ siteUrl, username, password }))
    log('info', 'auth.vault.saved', siteUrl, 'Credentials stored in Windows Credential Manager')
  }

  currentAuth = { headers: authHeaders, agent, siteUrl, method: 'credentials', username }
  log('info', 'auth.credentials.success', siteUrl, `Authenticated as ${username}`)
  return currentAuth
}

export async function loginFromVault(siteUrl: string): Promise<AuthResult | null> {
  try {
    const stored = await getStoredCredentialsFor(siteUrl)
    if (!stored) return null
    return await loginWithCredentials(siteUrl, stored.username, stored.password, false)
  } catch {
    return null
  }
}

export async function loginFromStoredCredentials(siteUrl?: string): Promise<AuthResult | null> {
  try {
    if (siteUrl) return await loginFromVault(siteUrl)

    const stored = await getStoredCredentials()
    if (!stored) return null

    return await loginWithCredentials(stored.siteUrl, stored.username, stored.password, false)
  } catch {
    return null
  }
}

export async function reauthenticate(siteUrl: string): Promise<AuthResult | null> {
  const ssoResult = await trySso(siteUrl)
  if (ssoResult) return ssoResult
  return loginFromVault(siteUrl)
}

export async function ensureAuthForSite(siteUrl: string): Promise<AuthResult | null> {
  if (currentAuth?.siteUrl === siteUrl) return currentAuth

  const refreshed = await reauthenticate(siteUrl)
  if (refreshed) return refreshed

  if (currentAuth && sameOrigin(currentAuth.siteUrl, siteUrl)) {
    return currentAuth
  }

  return null
}

export async function logout(clearSavedCredentials = false): Promise<void> {
  currentAuth = null
  if (clearSavedCredentials) {
    try { await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT) } catch { /* no entry */ }
    log('info', 'auth.logout', '', 'Logged out and cleared saved credentials')
    return
  }

  log('info', 'auth.logout', '', 'Logged out')
}

export async function getAuthRequestOptions(requestUrl?: string): Promise<{ headers: Record<string, string>; agent?: HttpAgent | HttpsAgent }> {
  if (!currentAuth) throw new Error('Not authenticated')

  if (requestUrl && currentAuth.method === 'credentials') {
    try {
      const stored = await getStoredCredentialsFor(requestUrl)
      if (stored) {
        const authData = await getAuth(requestUrl, stored)
        return {
          headers: authData.headers as Record<string, string>,
          agent: getAuthAgent(authData),
        }
      }
    } catch (err) {
      log('warn', 'auth.credentials.refresh.failed', requestUrl, String(err))
    }
  }

  return { headers: currentAuth.headers, agent: currentAuth.agent }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  return (await getAuthRequestOptions()).headers
}

async function validateAuth(siteUrl: string, headers: Record<string, string>, agent?: unknown): Promise<void> {
  const url = siteUrl.replace(/\/$/, '') + '/_api/web?$select=Title'
  const resp = await fetch(url, {
    headers: { ...headers, Accept: 'application/json;odata=nometadata' },
    ...(agent ? { agent: agent as import('http').Agent } : {}),
  })
  if (!resp.ok) throw new Error(`SharePoint validation failed: HTTP ${resp.status}`)
}
