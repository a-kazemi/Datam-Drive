export interface Library {
  id: number
  site_url: string
  list_id: string
  title: string
  local_root: string
  change_token: string | null
  last_polled: number | null
  permission_level: 'rw' | 'ro' | 'hidden'
  status: 'syncing' | 'idle' | 'error' | 'paused'
}

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  event: string
  file: string
  detail: string
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'paused' | 'error'
  libraryCount: number
  errorCount: number
}

export interface Settings {
  pollIntervalMs: number
  maxFileSizeBytes: number
  autoUpdate: boolean
  updateFeedUrl: string
  paused: boolean
}

export interface AuthStatus {
  authenticated: boolean
  siteUrl: string | null
  username: string | null
  method: 'sso' | 'credentials' | null
}

export interface SpListInfo {
  Id: string
  Title: string
  RootFolder: { ServerRelativeUrl: string }
}
