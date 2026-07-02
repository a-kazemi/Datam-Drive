import React, { useState, useEffect, useCallback } from 'react'
import type { Library, LogEntry, SyncStatus as SyncStatusType } from '../../shared/ipc-types'

interface Props {
  onOpenSettings: () => void
  onLogout: () => void
}

export default function SyncStatus({ onOpenSettings, onLogout }: Props) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatusType>({ status: 'idle', libraryCount: 0, errorCount: 0 })
  const [paused, setPaused] = useState(false)
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [showAddLibrary, setShowAddLibrary] = useState(false)

  const refresh = useCallback(async () => {
    const [libs, status] = await Promise.all([
      window.datamDrive.invoke('libraries:list') as Promise<Library[]>,
      window.datamDrive.invoke('sync:status') as Promise<SyncStatusType>,
    ])
    setLibraries(libs)
    setSyncStatus(status)
  }, [])

  useEffect(() => {
    refresh()
    window.datamDrive.invoke('log:recent').then(entries => setLogs(entries as LogEntry[]))

    const unsubLib  = window.datamDrive.on('libraries:changed', refresh)
    const unsubLog  = window.datamDrive.on('log:entry', (entry: unknown) => {
      setLogs(prev => [...prev.slice(-99), entry as LogEntry])
    })
    const unsubSync = window.datamDrive.on('sync:state', (state: unknown) => {
      const s = state as { paused: boolean }
      setPaused(s.paused)
    })

    return () => { unsubLib(); unsubLog(); unsubSync() }
  }, [refresh])

  async function togglePause() {
    if (paused) {
      await window.datamDrive.invoke('sync:resume')
      setPaused(false)
    } else {
      await window.datamDrive.invoke('sync:pause')
      setPaused(true)
    }
  }

  const filteredLogs = logFilter === 'all' ? logs : logs.filter(l => l.level === logFilter)
  const syncing = syncStatus.status === 'syncing'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      {/* Header */}
      <div style={{
        height: 52, background: '#FAFAFA', borderBottom: '1px solid #E8E8E8',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 22, height: 22, background: '#0078D4', borderRadius: 4,
            fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>☁</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>DatamDrive</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: syncStatus.status === 'error' ? '#FCEAEA' : '#E9F4FB',
          border: `1px solid ${syncStatus.status === 'error' ? '#F5C6C6' : '#BAD7EF'}`,
          borderRadius: 11, padding: '3px 10px', fontSize: 12,
          color: syncStatus.status === 'error' ? '#C62828' : '#0078D4', marginLeft: 'auto',
        }}>
          <div style={{
            width: 6, height: 6,
            background: syncing ? '#0078D4' : syncStatus.status === 'error' ? '#C62828' : '#28A745',
            borderRadius: '50%',
          }} />
          {paused ? 'Paused' : syncing ? 'Syncing…' : syncStatus.status === 'error' ? 'Error' : 'Idle'}
        </div>

        <span style={{ fontSize: 12, color: '#999' }}>
          {libraries.length} librar{libraries.length === 1 ? 'y' : 'ies'}
        </span>

        <button onClick={togglePause} style={headerBtnStyle}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button onClick={onOpenSettings} style={headerBtnStyle}>⚙ Settings</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
        {/* Libraries section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={sectionHdStyle}>Libraries</span>
            <button
              onClick={() => setShowAddLibrary(true)}
              style={{ fontSize: 11, color: '#0078D4', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              + Add Library
            </button>
          </div>

          {libraries.length === 0 ? (
            <div style={{
              border: '1.5px dashed #DCDCDC', borderRadius: 8, padding: '24px',
              textAlign: 'center', color: '#AAA', fontSize: 13,
            }}>
              No libraries synced yet.{' '}
              <span
                onClick={() => setShowAddLibrary(true)}
                style={{ color: '#0078D4', cursor: 'pointer' }}
              >
                Add your first library →
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {libraries.map(lib => <LibraryCard key={lib.id} lib={lib} onRemove={() => {
                window.datamDrive.invoke('libraries:remove', lib.id).then(() => refresh())
              }} />)}
            </div>
          )}
        </div>

        {/* Activity log */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={sectionHdStyle}>Recent Activity</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['all', 'info', 'warn', 'error'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setLogFilter(f)}
                  style={{
                    padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: logFilter === f ? '#E0E0E0' : 'transparent',
                    color: logFilter === f ? '#333' : '#AAA',
                    textTransform: 'uppercase',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', border: '1px solid #F0F0F0', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr>
                  {['Time', 'Level', 'Event', 'File / Detail'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '6px 8px', background: '#F5F5F5',
                      fontSize: 10, fontWeight: 700, color: '#AAA', textTransform: 'uppercase',
                      letterSpacing: '0.4px', borderBottom: '1px solid #EBEBEB', position: 'sticky', top: 0,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '12px 8px', color: '#CCC', textAlign: 'center' }}>No activity yet</td></tr>
                ) : (
                  [...filteredLogs].reverse().map((entry, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                      <td style={tdStyle}>{entry.ts.slice(11, 19)}</td>
                      <td style={tdStyle}><LevelBadge level={entry.level} /></td>
                      <td style={tdStyle}>{entry.event}</td>
                      <td style={{ ...tdStyle, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#555' }}>{entry.file}</span>
                        {entry.detail && <span style={{ color: '#AAA' }}> — {entry.detail}</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        height: 28, background: '#F5F5F5', borderTop: '1px solid #EBEBEB', flexShrink: 0,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 20,
        fontSize: 11, color: '#AAA',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: syncStatus.errorCount > 0 ? '#C62828' : '#28A745', display: 'inline-block' }} />
          Polling every 30s
        </span>
        <span>{syncStatus.errorCount} error{syncStatus.errorCount !== 1 ? 's' : ''}</span>
        <span style={{ marginLeft: 'auto', cursor: 'pointer', color: '#0078D4' }} onClick={onLogout}>Sign out</span>
      </div>

      {showAddLibrary && (
        <AddLibraryModal
          onClose={() => setShowAddLibrary(false)}
          onAdded={() => { setShowAddLibrary(false); refresh() }}
        />
      )}
    </div>
  )
}

function LibraryCard({ lib, onRemove }: { lib: Library; onRemove: () => void }) {
  const isRo = lib.permission_level === 'ro'
  const syncing = lib.status === 'syncing'

  return (
    <div style={{ border: '1px solid #EBEBEB', borderRadius: 8, padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{lib.title}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9,
            background: isRo ? '#FFF8E1' : '#E8F5E9',
            color: isRo ? '#C45000' : '#2A7D2A',
            border: `1px solid ${isRo ? '#F9DFAA' : '#C5E1C5'}`,
          }}>
            {isRo ? 'RO 🔒' : 'RW'}
          </span>
          <button
            onClick={onRemove}
            title="Remove library"
            style={{ background: 'none', border: 'none', color: '#CCC', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
          >✕</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#AAA', marginBottom: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lib.site_url}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: syncing ? '#0078D4' : '#AAA' }}>
        {syncing ? '↑↓' : '↓'}
        {syncing ? 'Syncing…' : lib.last_polled ? `Last synced ${formatAge(lib.last_polled)} ago` : 'Waiting for first sync'}
      </div>
    </div>
  )
}

function AddLibraryModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [libraries, setLibraries] = useState<import('../../shared/ipc-types').SpListInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [localRoot, setLocalRoot] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'pick-site' | 'pick-lib' | 'pick-folder'>('pick-site')

  useEffect(() => {
    window.datamDrive.invoke('auth:status').then(status => {
      const auth = status as { siteUrl: string | null }
      if (auth.siteUrl) setSiteUrl(auth.siteUrl)
    })
  }, [])

  async function loadLibraries() {
    setError(''); setLoading(true)
    const requestedSiteUrl = siteUrl.trim()
    if (!requestedSiteUrl) { setError('Enter a SharePoint site URL.'); setLoading(false); return }
    const r = await window.datamDrive.invoke('libraries:enumerate', requestedSiteUrl) as { success: boolean; libraries?: import('../../shared/ipc-types').SpListInfo[]; error?: string }
    setLoading(false)
    if (r.success && r.libraries) { setLibraries(r.libraries); setStep('pick-lib') }
    else setError(r.error ?? 'Failed to enumerate libraries.')
  }

  async function addLibrary() {
    if (!selected || !localRoot.trim()) { setError('Select a library and choose a local folder.'); return }
    const lib = libraries.find(l => l.Id === selected)!
    setError(''); setLoading(true)

    const r = await window.datamDrive.invoke('libraries:add', {
      siteUrl: siteUrl.trim(),
      listId: selected,
      title: lib.Title,
      localRoot: localRoot.trim(),
    }) as { success: boolean; error?: string }

    setLoading(false)
    if (r.success) onAdded()
    else setError(r.error ?? 'Failed to add library.')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F0F0F0' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Add Library</h3>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {step === 'pick-site' && (
            <>
              <label style={modalLabel}>SharePoint Site URL</label>
              <input
                type="url" value={siteUrl} onChange={e => setSiteUrl(e.target.value)}
                placeholder="https://sharepoint.company.local/sites/..." style={modalInput}
                onKeyDown={e => e.key === 'Enter' && loadLibraries()}
              />
              {error && <div style={{ color: '#C62828', fontSize: 12, marginTop: 8 }}>{error}</div>}
              <button onClick={loadLibraries} disabled={loading} style={{ ...modalBtn, marginTop: 16 }}>
                {loading ? 'Loading…' : 'Load Libraries →'}
              </button>
            </>
          )}

          {step === 'pick-lib' && (
            <>
              <label style={modalLabel}>Document Library</label>
              <div style={{ border: '1px solid #DCDCDC', borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>
                {libraries.map(lib => (
                  <div
                    key={lib.Id}
                    onClick={() => setSelected(lib.Id)}
                    style={{
                      padding: '9px 12px', cursor: 'pointer', fontSize: 13,
                      background: selected === lib.Id ? '#E9F4FB' : 'transparent',
                      color: selected === lib.Id ? '#0078D4' : '#111',
                      borderBottom: '1px solid #F5F5F5',
                    }}
                  >
                    📁 {lib.Title}
                    <span style={{ fontSize: 11, color: '#AAA', marginLeft: 8 }}>{lib.RootFolder?.ServerRelativeUrl}</span>
                  </div>
                ))}
              </div>

              <label style={{ ...modalLabel, marginTop: 16 }}>Local Folder</label>
              <input
                type="text" value={localRoot} onChange={e => setLocalRoot(e.target.value)}
                placeholder="C:\Users\You\DatamDrive\Engineering Docs" style={modalInput}
              />

              {error && <div style={{ color: '#C62828', fontSize: 12, marginTop: 8 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setStep('pick-site')} style={{ ...modalBtn, background: '#F5F5F5', color: '#333', flex: 1 }}>
                  ← Back
                </button>
                <button onClick={addLibrary} disabled={loading || !selected} style={{ ...modalBtn, flex: 2 }}>
                  {loading ? 'Adding…' : 'Add Library'}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid #F0F0F0', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function LevelBadge({ level }: { level: 'info' | 'warn' | 'error' }) {
  const styles: Record<string, { bg: string; color: string }> = {
    info:  { bg: '#E9F4FB', color: '#0078D4' },
    warn:  { bg: '#FFF8E1', color: '#C45000' },
    error: { bg: '#FCEAEA', color: '#C62828' },
  }
  const s = styles[level]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
      background: s.bg, color: s.color,
    }}>
      {level.toUpperCase()}
    </span>
  )
}

function formatAge(epochMs: number): string {
  const s = Math.floor((Date.now() - epochMs) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const sectionHdStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.7px',
}
const tdStyle: React.CSSProperties = { padding: '6px 8px', color: '#333', borderBottom: '1px solid #F5F5F5' }
const headerBtnStyle: React.CSSProperties = {
  height: 28, padding: '0 12px', background: 'transparent', border: '1px solid #E0E0E0',
  borderRadius: 4, fontSize: 12, color: '#555', cursor: 'pointer', fontFamily: 'inherit',
}
const modalLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: 6, display: 'block',
}
const modalInput: React.CSSProperties = {
  width: '100%', height: 38, border: '1.5px solid #DCDCDC', borderRadius: 4,
  padding: '0 12px', fontSize: 13, color: '#111', fontFamily: 'inherit', outline: 'none',
}
const modalBtn: React.CSSProperties = {
  height: 38, background: '#0078D4', color: '#fff', border: 'none',
  borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit', width: '100%',
}
