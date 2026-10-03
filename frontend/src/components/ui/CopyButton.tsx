// src/components/ui/CopyButton.tsx — reusable "copy to clipboard" icon button
import { useState } from 'react'
import { useT } from '../../i18n/useT'

interface CopyButtonProps {
  text: string
  size?: number
  label?: string
}

export default function CopyButton({ text, size = 18, label }: CopyButtonProps) {
  const t = useT()
  const resolvedLabel = label ?? t('copy.label')
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation() // never trigger a parent card's own click action
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setFailed(false)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setFailed(true)
      setTimeout(() => setFailed(false), 1800)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={handleClick} aria-label={resolvedLabel} type="button"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: size + 16, height: size + 16, padding: 0, borderRadius: 8,
          background: copied ? 'var(--brand-light)' : 'var(--white)',
          border: '1px solid var(--border)', cursor: 'pointer',
          color: copied ? 'var(--link)' : 'var(--text3)',
        }}>
        {copied ? (
          // Checkmark
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          // Two overlapping rounded rectangles
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {(copied || failed) && (
        <span role="status" style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
          background: 'var(--ink, #1A0050)', color: '#fff', fontSize: 11, fontWeight: 600,
          pointerEvents: 'none',
        }}>
          {copied ? t('copy.copied') : t('copy.failed')}
        </span>
      )}
    </div>
  )
}
