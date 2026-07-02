import React, { useState, useEffect } from 'react'
import type { Settings } from '../../shared/ipc-types'

interface Props {
  onBack: () => void
}

export default function SettingsPage({ onBack }: Props) {
  const [settings, setSettings] = useState<Settings>({
    pollIntervalMs: 30000,
    maxFileSizeBytes: 50 * 1024 * 1024,
    autoUpdate: false,
    updateFeedUrl: '',
    paused: false,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.datamDrive.invoke('settings:get').then(s => setSettings(s as Settings))
  }, [])

  async function save() {
    await window.datamDrive.invoke('settings:set', settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const pollSecs = Math.round(settings.pollIntervalMs / 1000)
  const maxMb = Math.round(settings.maxFileSizeBytes / 1024 / 1024)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      {/* Header */}
      <div style={{
        height: 52, background: '#FAFAFA', borderBottom: '1px solid #E8E8E8',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#555', padding: '0 4px' }}>←</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 22, height: 22, background: '#0078D4', borderRadius: 4, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>☁</div>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>DatamDrive — Settings</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px', maxWidth: 560 }}>
        <Section title="Sync">
          <Field label="Poll interval" hint="How often to check SharePoint for changes (10–300 seconds)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={10} max={300} value={pollSecs}
                onChange={e => setSettings(s => ({ ...s, pollIntervalMs: parseInt(e.target.value) * 1000 }))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 13, color: '#555', width: 60 }}>{pollSecs}s</span>
            </div>
          </Field>

          <Field label="Max file size" hint="Files larger than this are skipped with an error notification">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={10} max={500} value={maxMb}
                onChange={e => setSettings(s => ({ ...s, maxFileSizeBytes: parseInt(e.target.value) * 1024 * 1024 }))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 13, color: '#555', width: 60 }}>{maxMb} MB</span>
            </div>
          </Field>
        </Section>

        <Section title="Updates">
          <Field label="Auto-update" hint="Check for updates on startup and notify when a new version is available. Off by default — required for air-gapped deployments.">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={e => setSettings(s => ({ ...s, autoUpdate: e.target.checked }))}
              />
              <span style={{ fontSize: 13, color: '#111' }}>Enable auto-update</span>
            </label>
          </Field>

          {settings.autoUpdate && (
            <Field label="Update feed URL" hint="Leave blank to use GitHub Releases. For air-gapped deployments, point to your self-hosted server.">
              <input
                type="url"
                value={settings.updateFeedUrl}
                onChange={e => setSettings(s => ({ ...s, updateFeedUrl: e.target.value }))}
                placeholder="https://github.com/datamdrive/datamdrive/releases/latest/download/latest.yml"
                style={inputStyle}
              />
            </Field>
          )}
        </Section>

        <Section title="About">
          <div style={{ fontSize: 12, color: '#777', lineHeight: 1.6 }}>
            <div>DatamDrive — open-source SharePoint sync client</div>
            <div>MIT License — <a href="#" style={{ color: '#0078D4' }}>GitHub</a></div>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => window.datamDrive.invoke('updater:check')}
                style={{ fontSize: 12, color: '#0078D4', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
              >
                Check for updates
              </button>
            </div>
          </div>
        </Section>
      </div>

      <div style={{
        height: 52, borderTop: '1px solid #E8E8E8', padding: '0 32px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={save}
          style={{
            height: 36, padding: '0 24px', background: '#0078D4', color: '#fff',
            border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
        <button onClick={onBack} style={{ height: 36, padding: '0 16px', background: 'none', border: '1px solid #DCDCDC', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 16 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: '#AAA', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, border: '1.5px solid #DCDCDC', borderRadius: 4,
  padding: '0 12px', fontSize: 13, color: '#111', fontFamily: 'inherit', outline: 'none',
}
