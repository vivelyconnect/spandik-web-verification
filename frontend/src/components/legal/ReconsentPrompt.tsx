// src/components/legal/ReconsentPrompt.tsx — SP-15-12
// Checked once per app load (mirrors PinModal/SecureChatsPrompt's mount
// pattern in App.tsx). Unlike SecureChatsPrompt, there is no "Not now" —
// this is a legal acceptance, not a security nudge, so it stays until
// accepted.
import { useState, useEffect } from 'react'
import { FileText } from 'lucide-react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../utils/api'
import { useT } from '../../i18n/useT'

export default function ReconsentPrompt() {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    api.get('/auth/consent-status')
      .then(res => {
        const status = res.data?.data
        if (status && (!status.terms_current || !status.privacy_current)) setShow(true)
      })
      .catch(() => { /* couldn't check — don't block on an unclear state */ })
  }, [user])

  async function handleAgree() {
    setLoading(true)
    try {
      await api.post('/auth/consent', { locale: navigator.language?.slice(0, 2) })
      setShow(false)
    } catch { /* stays open — user can retry */ }
    setLoading(false)
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
          <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
            style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '32px 28px', maxWidth: 420, width: '100%' }}>

            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <FileText size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 10, color: 'var(--link)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                {t('reconsent.heading')}
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6 }}>
                {t('reconsent.reviewPrefix')}{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)' }}>{t('auth.consentTermsLink')}</a>{' '}
                {t('auth.consentTermsAnd')}{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)' }}>{t('auth.consentPrivacyLink')}</a>{' '}
                {t('reconsent.agreeSuffix')}
              </p>
            </div>

            <motion.button whileTap={{ scale: 0.97 }}
              onClick={handleAgree}
              disabled={loading}
              style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)', opacity: loading ? 0.7 : 1 }}>
              {loading ? t('reconsent.savingEllipsis') : t('reconsent.iAgreeButton')}
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
