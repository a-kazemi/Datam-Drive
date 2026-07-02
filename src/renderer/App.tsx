import React, { useState, useEffect } from 'react'
import SetupWizard from './pages/SetupWizard'
import SyncStatus from './pages/SyncStatus'
import SettingsPage from './pages/Settings'
import type { AuthStatus } from '../shared/ipc-types'

declare global {
  interface Window {
    datamDrive: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, fn: (...args: unknown[]) => void) => () => void
    }
  }
}

type Page = 'setup' | 'status' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('setup')
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    // Check if already authenticated (e.g. app relaunch with vault credentials)
    window.datamDrive.invoke('auth:status').then(s => {
      const status = s as AuthStatus
      if (status.authenticated) {
        setAuthenticated(true)
        setPage('status')
      }
    })

    // Tray menu navigation
    const unsub = window.datamDrive.on('navigate', (target: unknown) => {
      setPage(target as Page)
    })

    // Tray "Pause/Resume" toggle
    const unsub2 = window.datamDrive.on('sync:toggle', () => {
      // Handled inside SyncStatus
    })

    return () => { unsub(); unsub2() }
  }, [])

  if (!authenticated) {
    return (
      <SetupWizard
        onAuthenticated={() => {
          setAuthenticated(true)
          setPage('status')
        }}
      />
    )
  }

  if (page === 'settings') {
    return <SettingsPage onBack={() => setPage('status')} />
  }

  return (
    <SyncStatus
      onOpenSettings={() => setPage('settings')}
      onLogout={() => {
        window.datamDrive.invoke('auth:logout')
        setAuthenticated(false)
        setPage('setup')
      }}
    />
  )
}
