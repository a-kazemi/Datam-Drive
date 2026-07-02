import React from 'react'

type Props = {
  compact?: boolean
  onDark?: boolean
}

export default function DatamLogo({ compact = false, onDark = false }: Props) {
  const markSize = compact ? 24 : 30
  const textColor = onDark ? '#FFFFFF' : '#2E7D3A'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 10 }}>
      <div
        aria-hidden="true"
        style={{
          width: markSize,
          height: markSize,
          borderRadius: compact ? 4 : 6,
          background: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: onDark ? '0 0 0 1px rgba(255,255,255,0.12)' : '0 0 0 1px rgba(46,125,58,0.14)',
          flexShrink: 0,
        }}
      >
        <svg viewBox="0 0 64 64" width={markSize - 4} height={markSize - 4} role="img" aria-label="Datam logo">
          <path
            d="M17 8h20c12.7 0 22 9.3 22 23.3C59 45 49.3 56 36.4 56H22v-8h14.5C44.8 48 51 40.8 51 31.3 51 21.2 44.9 16 36.8 16H25v27l-8 10V8Z"
            fill="#2E7D3A"
          />
          <path
            d="M16 56c.6-14.4 8.1-26.9 25.5-36.2C27.8 31.2 24.3 42.4 24.2 56H16Z"
            fill="#2E7D3A"
          />
          <circle cx="29.8" cy="27.6" r="4.7" fill="#2E7D3A" />
        </svg>
      </div>
      <span style={{ color: textColor, fontSize: compact ? 14 : 18, fontWeight: 500, lineHeight: 1 }}>
        Datam
      </span>
    </div>
  )
}
