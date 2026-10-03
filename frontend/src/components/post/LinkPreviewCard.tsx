// src/components/post/LinkPreviewCard.tsx — SP-11-06
//
// Renders a server-generated, already-sanitized link preview. Every value
// here is plain text from the API (never HTML) — React's default escaping
// is the only rendering path, `dangerouslySetInnerHTML` is never used,
// matching this codebase's existing convention (see PostCard's own
// `renderContent`). The hostname is always shown, same size/weight as the
// title, never hidden behind the (untrusted, third-party) title text
// (Section 23 — phishing/domain transparency).
import { useT } from '../../i18n/useT'
import { X } from 'lucide-react'

export interface LinkPreviewData {
  url: string
  hostname: string | null
  title?: string | null
  description?: string | null
  site_name?: string | null
  image_url?: string | null
}

export default function LinkPreviewCard({
  preview, loading, onRemove, compact,
}: {
  preview: LinkPreviewData | null
  loading?: boolean
  onRemove?: () => void
  compact?: boolean
}) {
  const t = useT()

  if (!loading && !preview) return null

  return (
    <div data-testid="link-preview-card" style={{
      display: 'flex', border: '1px solid var(--border)', borderRadius: 12,
      overflow: 'hidden', marginTop: 10, background: 'var(--bg2)', position: 'relative',
    }}>
      {loading ? (
        <div data-testid="link-preview-loading" style={{ padding: 14, fontSize: 13, color: 'var(--text4)', width: '100%' }}>
          {t('linkPreview.loading')}
        </div>
      ) : preview && (
        <>
          <a href={preview.url} target="_blank" rel="noopener noreferrer nofollow"
            style={{ display: 'flex', flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            {preview.image_url && (
              <img src={preview.image_url} alt=""
                style={{ width: compact ? 72 : 96, height: compact ? 72 : 96, objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' }} />
            )}
            <div style={{ padding: '10px 12px', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
              {preview.title && (
                <div style={{
                  fontSize: 13.5, fontWeight: 700, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {preview.title}
                </div>
              )}
              {/* Real destination hostname — always rendered, never suppressed. */}
              <div data-testid="link-preview-hostname" style={{ fontSize: 11.5, color: 'var(--text4)', fontWeight: 600 }}>
                {preview.hostname}
              </div>
              {preview.description && (
                <div style={{
                  fontSize: 12, color: 'var(--text3)', overflow: 'hidden',
                  textOverflow: 'ellipsis', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {preview.description}
                </div>
              )}
            </div>
          </a>
          {onRemove && (
            <button onClick={onRemove} aria-label={t('linkPreview.removeAria')} title={t('linkPreview.remove')}
              style={{
                position: 'absolute', top: 0, right: 0, width: 44, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
              }}>
              <span style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: '50%', fontSize: 12, lineHeight: 1,
              }}><X size={14} aria-hidden /></span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
