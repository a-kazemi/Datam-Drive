import React, { useState } from 'react'
import DatamLogo from '../components/DatamLogo'

interface Props {
  onAuthenticated: () => void
}

type Step = 1 | 2 | 3

const STEPS = [
  { n: 1, label: 'Connect',           sub: 'SharePoint site URL' },
  { n: 2, label: 'Authenticate',      sub: 'Windows SSO or credentials' },
  { n: 3, label: 'Choose Libraries',  sub: 'Pick what to sync' },
]

export default function SetupWizard({ onAuthenticated }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    if (!siteUrl.trim()) { setError('Please enter a SharePoint site URL.'); return }
    setError(''); setLoading(true)

    // Try SSO first; fall through to credentials step if it fails
    const result = await window.datamDrive.invoke('auth:try-sso', siteUrl) as { success: boolean }
    setLoading(false)

    if (result.success) {
      onAuthenticated()
    } else {
      setStep(2)
    }
  }

  async function handleLogin() {
    if (!username.trim() || !password) { setError('Enter domain\\username and password.'); return }
    setError(''); setLoading(true)

    const r = await window.datamDrive.invoke('auth:login', { siteUrl, username, password }) as { success: boolean; error?: string }
    setLoading(false)

    if (r.success) {
      onAuthenticated()
    } else {
      setError(r.error ?? 'Authentication failed.')
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Dark sidebar */}
      <div style={{
        width: 224, background: '#2C2C3E', padding: '28px 20px',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ marginBottom: 40 }}>
          <DatamLogo onDark />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {STEPS.map((s, i) => {
            const active = step === s.n
            const done = step > s.n
            return (
              <div key={s.n} style={{ display: 'flex', alignItems: 'flex-start', gap: 13, padding: '11px 0', position: 'relative' }}>
                {i < STEPS.length - 1 && (
                  <div style={{
                    position: 'absolute', left: 11, top: 34,
                    width: 2, height: 'calc(100% - 10px)',
                    background: '#3D3D55',
                  }} />
                )}
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: active || done ? '#0078D4' : '#3D3D55',
                  color: active || done ? '#fff' : '#666',
                }}>
                  {done ? '✓' : s.n}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, color: active ? '#fff' : '#555' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#4A4A62', marginTop: 2 }}>{s.sub}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '40px 44px', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {step === 1 && (
          <>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: '#111', marginBottom: 8 }}>
              Connect to SharePoint
            </h2>
            <p style={{ fontSize: 13, color: '#777', marginBottom: 32, lineHeight: 1.5 }}>
              Enter your on-premise SharePoint site URL to get started.
            </p>

            <label style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              SharePoint Site URL
            </label>
            <div style={{ position: 'relative', marginBottom: 22 }}>
              <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15 }}>🌐</span>
              <input
                type="url"
                placeholder="https://sharepoint.company.local"
                value={siteUrl}
                onChange={e => setSiteUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                style={{
                  width: '100%', height: 40, border: '1.5px solid #DCDCDC', borderRadius: 4,
                  padding: '0 12px 0 38px', fontSize: 13, color: '#111', background: '#FAFAFA',
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{ color: '#C62828', fontSize: 12, marginBottom: 12 }}>{error}</div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading}
              style={{
                width: '100%', height: 44, background: loading ? '#AAA' : '#0078D4',
                color: '#fff', border: 'none', borderRadius: 4, fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16,
                fontFamily: 'inherit',
              }}
            >
              <WinLogo />
              {loading ? 'Connecting…' : 'Connect with Windows SSO'}
            </button>

            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 9,
              background: '#F0FAF0', border: '1px solid #B8DFC0', borderRadius: 4,
              padding: '11px 13px', marginBottom: 20,
            }}>
              <span style={{ color: '#2A7D3A', fontSize: 15, flexShrink: 0, paddingTop: 1 }}>✓</span>
              <p style={{ fontSize: 12, color: '#1C5C28', lineHeight: 1.55 }}>
                No password stored — DatamDrive uses your existing Windows login automatically via Kerberos/NTLM. Zero credentials are ever written to disk.
              </p>
            </div>

            <div style={{ fontSize: 11, color: '#AAA', textAlign: 'center', marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #F0F0F0' }}>
              Not on a domain? A credentials prompt will appear instead.<br />
              Stored securely in Windows Credential Manager (DPAPI), never in plaintext.
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: '#111', marginBottom: 8 }}>
              Sign In
            </h2>
            <p style={{ fontSize: 13, color: '#777', marginBottom: 32, lineHeight: 1.5 }}>
              Windows SSO was not available. Enter your SharePoint credentials.
            </p>

            <label style={labelStyle}>Domain\Username</label>
            <input
              type="text"
              placeholder="DOMAIN\username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 16 }}>Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              style={inputStyle}
            />

            {error && <div style={{ color: '#C62828', fontSize: 12, margin: '12px 0' }}>{error}</div>}

            <button
              onClick={handleLogin}
              disabled={loading}
              style={{ ...btnStyle, marginTop: 24, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <button
              onClick={() => { setStep(1); setError('') }}
              style={{ background: 'none', border: 'none', color: '#0078D4', cursor: 'pointer', marginTop: 12, fontSize: 13 }}
            >
              ← Back
            </button>

            <div style={{ fontSize: 11, color: '#AAA', marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #F0F0F0', textAlign: 'center' }}>
              Credentials stored in Windows Credential Manager (DPAPI), never in plaintext.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function WinLogo() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, width: 16, height: 16 }}>
      {[0,1,2,3].map(i => (
        <span key={i} style={{ background: 'rgba(255,255,255,0.92)', borderRadius: 1 }} />
      ))}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: 6, display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 40, border: '1.5px solid #DCDCDC', borderRadius: 4,
  padding: '0 12px', fontSize: 13, color: '#111', background: '#FAFAFA',
  fontFamily: 'inherit', outline: 'none',
}

const btnStyle: React.CSSProperties = {
  width: '100%', height: 44, background: '#0078D4', color: '#fff', border: 'none',
  borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
}
