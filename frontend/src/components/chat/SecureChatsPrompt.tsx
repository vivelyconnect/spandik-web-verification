// src/components/chat/SecureChatsPrompt.tsx (SP-1-04, hardened SP-1-04R)
// Blocking-but-friendly prompt for accounts whose local key still traces
// back to an unencrypted (pre-Chat-PIN) server backup: nudges them to set
// a Chat PIN so their existing key gets protected, without losing history
// (same identity_key, just re-encrypted — never a rotation).
import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../stores/authStore'
import { hasKeys, hasPassphrase, clearE2EKeys, protectChatKeyBackup, ensureE2EKeys, readServerBackup } from '../../utils/e2e'
import PinInput from './PinInput'
import toast from 'react-hot-toast'
import { useT } from '../../i18n/useT'

const SNOOZE_PREFIX = 'spandik_secure_prompt_snooze_'
const SNOOZE_MS = 24 * 60 * 60 * 1000 // 24h — temporary, never a permanent dismiss (SP-1-10 will make this mandatory)

function isSnoozed(userId: string): boolean {
  const until = Number(localStorage.getItem(`${SNOOZE_PREFIX}${userId}`) || 0)
  return Date.now() < until
}

function snooze(userId: string): void {
  localStorage.setItem(`${SNOOZE_PREFIX}${userId}`, String(Date.now() + SNOOZE_MS))
}

export default function SecureChatsPrompt() {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const accessToken = useAuthStore(s => s.accessToken)
  const [show, setShow]   = useState(false)
  const [pin, setPin]     = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    // Check inside the delay, not before scheduling it — ensureE2EKeys's
    // restore (incl. the legacy plain-key auto-restore) runs async right
    // after login and may not have finished the instant this effect fires.
    const timer = setTimeout(async () => {
      // Wave 3A step 4 (found in the production proof): a fixed 2.5 s was
      // not always enough for ensureE2EKeys to fetch + generate on a slow
      // network — right after a Chat PIN reset the prompt then never showed
      // and the new key stayed without a backup until the next app load.
      // ensureE2EKeys joins an in-flight run (or returns at once if keys exist).
      const token = useAuthStore.getState().accessToken
      if (token) await ensureE2EKeys(user.id, token).catch(() => {})
      if (!hasKeys(user.id) || hasPassphrase(user.id) || isSnoozed(user.id)) return

      // SP-1-04R: local state says "unprotected", but local state is exactly
      // what a prior bug could have corrupted (a bogus fallback-generated
      // keypair with has_passphrase permanently stuck false). Never trust
      // that alone — confirm against the server before nagging the user.
      try {
        const r = await readServerBackup(useAuthStore.getState().accessToken || '')
        if (!r.ok) return // couldn't verify — don't nag on unclear state, try again next open
        const { encrypted_private_key, nonce, salt, backup_mode } = r.data || {}
        if (backup_mode === 'max_privacy') return // SP-14-05: no backup by the user's choice — never nag
        if (encrypted_private_key && nonce && salt) {
          // Server already has a real encrypted backup — this device's local
          // key just doesn't match it (stale/bogus). Self-heal: clear it and
          // reload, so PinModal's own mount-check (which already ran and
          // skipped earlier in this same page load, back when hasKeys() was
          // still wrongly true) gets a clean re-run and correctly prompts
          // for the real PIN — a plain state-clear alone wouldn't do that
          // without the user manually refreshing.
          clearE2EKeys(user.id)
          window.location.reload()
          return
        }
        // Either a genuine plain backup, or no backup registered at all yet
        // (both legitimately need this flow) — matches SP-1-04's original scope.
        setShow(true)
      } catch { /* couldn't verify — don't nag on unclear state, try again next open */ }
    }, 2500)
    return () => clearTimeout(timer)
  }, [user])

  async function handleSecure() {
    if (!/^\d{6}$/.test(pin)) { setError(t('auth.pinDigitsError')); return }
    if (pin !== pinConfirm) { setError(t('auth.pinMismatch')); return }
    setError('')
    setLoading(true)
    const result = await protectChatKeyBackup(user!.id, pin, accessToken || '', true)
    setLoading(false)
    if (result === 'conflict') {
      // The server rejected this because it already has a DIFFERENT key
      // than this device's local one — i.e. local state was stale/wrong.
      // Self-heal the same way the trigger check does, and let the user
      // know what's actually going on instead of a dead-end retry loop.
      clearE2EKeys(user!.id)
      setShow(false)
      toast(t('pin.alreadySecuredElsewhere'))
      return
    }
    if (result === 'error') { setError(t('pin.couldNotSecureChats')); return }
    setShow(false)
    snooze(user!.id) // completed — nothing left to snooze against, but harmless to set
    toast.success(t('pin.chatsNowSecuredToast'))
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
          <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
            style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '32px 28px', maxWidth: 420, width: '100%' }}>

            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Lock size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 10, color: 'var(--link)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                {t('pin.secureYourChats')}
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6 }}>
                {t('pin.secureYourChatsBody')}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textAlign: 'center' }}>{t('auth.enterPinLabel')}</label>
                <PinInput value={pin} onChange={v => { setPin(v); setError('') }} autoFocus error={!!error} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textAlign: 'center' }}>{t('auth.confirmPinLabel')}</label>
                <PinInput value={pinConfirm} onChange={v => { setPinConfirm(v); setError('') }} error={!!error} />
              </div>

              {error && <div style={{ fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{error}</div>}

              <motion.button whileTap={{ scale: 0.97 }}
                onClick={handleSecure}
                disabled={loading}
                style={{ padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)', opacity: loading ? 0.7 : 1 }}>
                {loading ? t('pin.securingEllipsis') : t('pin.setPinSecureChatsButton')}
              </motion.button>

              <button onClick={() => { snooze(user!.id); setShow(false) }}
                style={{ padding: '10px', borderRadius: 12, fontSize: 13, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer' }}>
                {t('pwa.notNow')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
