import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { LogEntry } from '../shared/ipc-types'

export type { LogEntry }
export type LogLevel = 'info' | 'warn' | 'error'

const MAX_LOG_DAYS = 7
const MAX_LOG_BYTES = 50 * 1024 * 1024
const MAX_RECENT = 100

let logDir = ''
const recentEntries: LogEntry[] = []
let logEmitter: ((entry: LogEntry) => void) | null = null
let prunedThisSession = false

function getLogDir(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'DatamDrive', 'logs')
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function todayFileName(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `DatamDrive-${y}-${m}-${day}.jsonl`
}

function pruneOldLogs(): void {
  const dir = getLogDir()
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('DatamDrive-') && f.endsWith('.jsonl'))
      .map(f => ({ name: f, fp: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)

    let totalSize = 0
    const cutoff = Date.now() - MAX_LOG_DAYS * 86400 * 1000
    for (const file of files) {
      const size = fs.statSync(file.fp).size
      totalSize += size
      if (file.mtime < cutoff || totalSize > MAX_LOG_BYTES) {
        fs.unlinkSync(file.fp)
      }
    }
  } catch {
    // best-effort
  }
}

export function log(level: LogLevel, event: string, file: string, detail: string): void {
  if (!prunedThisSession) {
    prunedThisSession = true
    pruneOldLogs()
  }

  const entry: LogEntry = { ts: new Date().toISOString(), level, event, file, detail }

  recentEntries.push(entry)
  if (recentEntries.length > MAX_RECENT) recentEntries.shift()

  const line = JSON.stringify(entry) + '\n'
  try {
    fs.appendFileSync(path.join(getLogDir(), todayFileName()), line, 'utf8')
  } catch {
    // ignore write failures
  }

  logEmitter?.(entry)
}

export function setLogEmitter(fn: (entry: LogEntry) => void): void {
  logEmitter = fn
}

export function getRecentEntries(): LogEntry[] {
  return [...recentEntries]
}
