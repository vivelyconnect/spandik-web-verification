// src/components/chat/BackupUpgradePrompt.tsx — SP-14-02 migration for
// devices that already hold the chat key: the server backup still uses a
// pre-v3 KDF (or an older OPRF seed version), so it is still open to offline
// PIN guessing. Chat PIN + account password (fresh re-auth) re-wrap it as
// KDF v3 via upgradeChatBackup — same key, same PIN, history untouched.
// New-device restores get the same upgrade inside PinModal instead.
import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../stores/authStore'
import { usePinModalStore } from '../../stores/pinModalStore'
import { hasPassphrase, readServerBackup, backupNeedsUpgrade, upgradeChatBackup, unlockLocalKeys } from '../../utils/e2e'
import { retryAfterMinutes } from '../../utils/pinOprf'
import { api } from '../../utils/api'
import PinInput from './PinInput'
import toast from 'react-hot-toast'
import { useT } from '../../i18n/useT'

const SNOOZE_PREFIX = 'spandik_backup_upgrade_snooze_'
const SNOOZE_MS = 24 * 60 * 60 * 1000 // "Not now" — asked again next day, never dismissed for good

export default function BackupUpgradePrompt() {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const accessToken = useAuthStore(s => s.accessToken)
  const [show, setShow] = useState(false)
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    // After PinModal / SecureChatsPrompt have had their turn (2–2.5 s).
    const timer = setTimeout(async () => {
      if (!(await unlockLocalKeys(user.id)) || !hasPassphrase(user.id)) return
      if (usePinModalStore.getState().keysVersion > 0) return // restored this session — PinModal offered the upgrade
      if (Date.now() < Number(localStorage.getItem(SNOOZE_PREFIX + user.id) || 0)) return
      const r = await readServerBackup(useAuthStore.getState().accessToken || '').catch(() => null)
      const b = r?.ok ? r.data : null
      if (b?.encrypted_private_key && backupNeedsUpgrade(b.salt, b.oprf_version)) setShow(true)
    }, 4000)
    return () => clearTimeout(timer)
  }, [user])

  function later() {
    localStorage.setItem(SNOOZE_PREFIX + user!.id, String(Date.now() + SNOOZE_MS))
    setShow(false)
  }

  async function handleUpgrade() {
    if (!/^\d{6}$/.test(pin)) { setError(t('pin.enterYourPin')); return }
    if (!password) { setError(t('pin.enterAccountPassword')); return }
    setLoading(true)
    try {
      try { await api.post('/auth/reauth', { password }) } catch (err: any) {
        setError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain')); return
      }
      let ok = false
      try { ok = await upgradeChatBackup(user!.id, pin, accessToken || '') } catch (err: any) {
        setError(err?.status === 429 ? (retryAfterMinutes(err) ? t('pin.rateLimitedRetryIn', { n: String(retryAfterMinutes(err)) }) : t('pin.tooManyAttempts')) : t('pin.couldNotCheckPin')); return
      }
      if (!ok) { setError(t('pin.wrongPin')); setPin(''); return }
      toast.success(t('pin.backupUpgradedToast'))
      setShow(false)
    } finally { setLoading(false) }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
          <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
            role="dialog" aria-modal="true" aria-labelledby="backup-upgrade-title"
            style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '32px 28px', maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <Lock size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
            <h2 id="backup-upgrade-title" style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t('pin.upgradeBackupTitle')}</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6, textAlign: 'center' }}>{t('pin.upgradeBackupPromptBody')}</p>
            <div style={{ fontSize: 12.5, color: 'var(--text3)', alignSelf: 'flex-start' }}>{t('pin.yourChatPin')}</div>
            <PinInput value={pin} onChange={v => { setPin(v); setError('') }} autoFocus error={!!error} />
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')}
              style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
            {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
            <motion.button whileTap={{ scale: 0.97 }} onClick={handleUpgrade} disabled={loading}
              style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? t('pin.upgradingEllipsis') : t('pin.upgradeBackupButton')}
            </motion.button>
            <button onClick={later} disabled={loading}
              style={{ padding: '8px', borderRadius: 12, fontSize: 13, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer' }}>
              {t('pwa.notNow')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
