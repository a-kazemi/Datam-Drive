import { getDb } from './schema'
import type { Settings } from '../../shared/ipc-types'

function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getAllSettings(): Settings {
  return {
    pollIntervalMs: parseInt(getSetting('pollIntervalMs') ?? '30000'),
    maxFileSizeBytes: parseInt(getSetting('maxFileSizeBytes') ?? String(50 * 1024 * 1024)),
    startWithWindows: getSetting('startWithWindows') !== 'false',
    autoUpdate: getSetting('autoUpdate') === 'true',
    updateFeedUrl: getSetting('updateFeedUrl') ?? '',
    paused: getSetting('paused') === 'true',
  }
}

export function saveSettings(settings: Partial<Settings>): void {
  if (settings.pollIntervalMs != null) setSetting('pollIntervalMs', String(settings.pollIntervalMs))
  if (settings.maxFileSizeBytes != null) setSetting('maxFileSizeBytes', String(settings.maxFileSizeBytes))
  if (settings.startWithWindows != null) setSetting('startWithWindows', String(settings.startWithWindows))
  if (settings.autoUpdate != null) setSetting('autoUpdate', String(settings.autoUpdate))
  if (settings.updateFeedUrl != null) setSetting('updateFeedUrl', settings.updateFeedUrl)
  if (settings.paused != null) setSetting('paused', String(settings.paused))
}
