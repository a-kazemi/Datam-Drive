import { autoUpdater } from 'electron-updater'
import { getAllSettings } from '../db/settings'
import { log } from '../logger'

export type NotifyFn = (msg: string) => void
let notifyUser: NotifyFn = () => {}
export function setNotifyFn(fn: NotifyFn): void { notifyUser = fn }

let checking = false

// T10: Auto-update is opt-in and off by default — no outbound HTTPS on startup unless enabled
export function initUpdater(): void {
  const { autoUpdate, updateFeedUrl } = getAllSettings()

  if (!autoUpdate) {
    log('info', 'updater.disabled', '', 'Auto-update is off — no outbound check')
    return
  }

  if (updateFeedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl })
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', info => {
    log('info', 'updater.available', '', `Version ${(info as { version: string }).version} available`)
    notifyUser(`DatamDrive ${(info as { version: string }).version} is available. Open Settings to install.`)
  })

  autoUpdater.on('error', err => {
    log('warn', 'updater.error', '', String(err))
  })

  checkForUpdates()
}

export async function checkForUpdates(): Promise<void> {
  const { autoUpdate } = getAllSettings()
  if (!autoUpdate || checking) return
  checking = true
  try { await autoUpdater.checkForUpdates() }
  catch (err) { log('warn', 'updater.check.failed', '', String(err)) }
  finally { checking = false }
}

export async function downloadAndInstall(): Promise<void> {
  await autoUpdater.downloadUpdate()
  autoUpdater.quitAndInstall()
}
