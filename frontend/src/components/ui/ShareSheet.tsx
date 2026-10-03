// src/components/ui/ShareSheet.tsx
import { useEffect } from 'react'
import { AtSign, BookOpen, Link as LinkIcon, MessageCircle, Send, Share } from 'lucide-react'
import { m as motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { postApi } from '../../utils/api'
import { useT } from '../../i18n/useT'
import Overlay from './Overlay'

interface ShareSheetProps {
  postId: string
  content?: string | null
  sharingEnabled?: boolean
  onClose: () => void
}

export default function ShareSheet({ postId, sharingEnabled = true, onClose }: ShareSheetProps) {
  const t  = useT()
  const qc = useQueryClient()

  // SP-2-19: PostCard already hides the button that opens this sheet when
  // sharing is disabled — this is the defensive second layer (stale
  // component state, a caller that forgets to gate) so the sheet fails
  // closed rather than executing any share action.
  useEffect(() => { if (!sharingEnabled) onClose() }, [sharingEnabled])
  if (!sharingEnabled) return null

  // SP-11-07: this is the ONLY place any external-share/copy action gets
  // its url/title/text from — never the client-derived
  // `${origin}/p/${id}` + raw post content the old client-only sheet used.
  // A stale-open sheet (sharing disabled by the owner AFTER this sheet
  // opened) must re-authorize HERE, immediately before the browser side
  // effect, never trust the `sharingEnabled` prop it opened with.
  async function authorizeShare(): Promise<{ url: string; title: string; text: string } | null> {
    try {
      const res = await postApi.externalShare(postId)
      return res.data.data
    } catch (err: any) {
      toast.error(err?.response?.status === 403 ? t('share.disabledError') : t('share.genericError'))
      onClose()
      return null
    }
  }

  async function handleAddToStory() {
    try {
      await postApi.shareToStory(postId)
      qc.invalidateQueries({ queryKey: ['stories'] })
      toast.success(t('share.addedToStory'))
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.status === 403 ? t('share.disabledError') : t('share.genericError'))
    }
  }

  async function handleNativeShare() {
    const auth = await authorizeShare()
    if (!auth || !navigator.share) return
    try {
      await navigator.share({ title: auth.title, text: auth.text, url: auth.url })
      onClose()
    } catch {} // user cancellation — not an error
  }

  async function copyLink() {
    const auth = await authorizeShare()
    if (!auth) return
    await navigator.clipboard.writeText(auth.url)
    toast.success(t('share.linkCopied'))
    onClose()
  }

  async function shareWhatsApp() {
    const auth = await authorizeShare()
    if (!auth) return
    window.open(`https://wa.me/?text=${encodeURIComponent(auth.text + ' ' + auth.url)}`, '_blank')
    onClose()
  }

  async function shareTelegram() {
    const auth = await authorizeShare()
    if (!auth) return
    window.open(`https://t.me/share/url?url=${encodeURIComponent(auth.url)}&text=${encodeURIComponent(auth.text)}`, '_blank')
    onClose()
  }

  async function shareTwitter() {
    const auth = await authorizeShare()
    if (!auth) return
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(auth.text)}&url=${encodeURIComponent(auth.url)}`, '_blank')
    onClose()
  }

  const options = [
    { icon: <BookOpen size={20} aria-hidden />, label: t('share.addToStory'), action: handleAddToStory },
    ...(navigator.share ? [{ icon: <Share size={20} aria-hidden />, label: t('share.shareVia'), action: handleNativeShare }] : []),
    { icon: <MessageCircle size={20} aria-hidden />, label: t('share.whatsapp'), action: shareWhatsApp },
    { icon: <LinkIcon size={20} aria-hidden />, label: t('share.copyLink'), action: copyLink },
    { icon: <Send size={20} aria-hidden />, label: t('share.telegram'), action: shareTelegram },
    { icon: <AtSign size={20} aria-hidden />, label: t('share.twitter'), action: shareTwitter },
  ]

  return (
    <Overlay open onClose={onClose} ariaLabel={t('share.title')}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />

      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>{t('share.title')}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map(opt => (
          <motion.button
            key={opt.label}
            whileTap={{ scale: 0.98 }}
            onClick={opt.action}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 12px', borderRadius: 12, minHeight: 44,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 15, color: 'var(--text)', fontWeight: 500,
              textAlign: 'left', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ width: 32, display: 'flex', justifyContent: 'center', color: 'var(--text3)' }}>{opt.icon}</span>
            {opt.label}
          </motion.button>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%', marginTop: 12, padding: '12px', minHeight: 44,
          borderRadius: 12, background: 'var(--bg2)',
          border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 600, color: 'var(--text3)',
        }}
      >
        {t('share.cancel')}
      </button>
    </Overlay>
  )
}
