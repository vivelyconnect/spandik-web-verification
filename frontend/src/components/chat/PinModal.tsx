// src/components/chat/PinModal.tsx (SP-1-03, renamed from PassphraseModal.tsx)
// Shows ONLY when the user has an encrypted (Chat PIN-protected) key backup
// on the server and no local keys yet (i.e. logging in on a new device).
// Keys are always auto-initialized on login — the Chat PIN protects the
// server-side key backup, it is not an optional passphrase upgrade anymore.
import { useState, useEffect } from 'react'
import { ArrowLeft, Lock, TriangleAlert } from 'lucide-react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../../stores/authStore'
import { usePinModalStore } from '../../stores/pinModalStore'
import { hasKeys } from '../../utils/e2e'
import { api } from '../../utils/api'
import PinInput from './PinInput'
import toast from 'react-hot-toast'
import { useT } from '../../i18n/useT'

type Mode = 'pin' | 'passphrase' | 'recovery'

export default function PinModal({ onComplete }: { onComplete?: () => void }) {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const accessToken = useAuthStore(s => s.accessToken)
  const manualOpen = usePinModalStore(s => s.open)
  const closePinModal = usePinModalStore(s => s.closePinModal)
  const notifyKeysRestored = usePinModalStore(s => s.notifyKeysRestored)
  const [show, setShow]     = useState(false)
  const [pin, setPin]       = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  // SP-1-03: the default UX is a 6-digit Chat PIN, but at least one real
  // account already protected its backup with a longer free-form passphrase
  // via the older flow this replaces — that secret is never migrated by this
  // task (SP-1-04 only migrates *plain* backups, not passphrase-protected
  // ones), so a fallback must exist or that account gets locked out on a new
  // device. `deriveKeyFromSaltField` is length/charset-agnostic either way.
  // SP-1-05 adds a third mode: restore via a 64-char recovery key.
  const [mode, setMode] = useState<Mode>('pin')
  // SP-14-05: a maximum-privacy account has no server backup at all — the
  // only way onto a new device is the user's own key (recovery mode only).
  const [maxPrivacy, setMaxPrivacy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  // SP-1-13: "forgot PIN, no recovery key" reset flow
  const [showForgot, setShowForgot] = useState(false)
  const [forgotPassword, setForgotPassword] = useState('')
  const [forgotConfirmed, setForgotConfirmed] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  // Wave 3A step 4: a recovery-key restore means the PIN was forgotten — the
  // server backup is still locked with it, so the user sets a new one here
  // (re-encrypts this same key; history is unaffected).
  const [newPinStep, setNewPinStep] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [newPinPassword, setNewPinPassword] = useState('') // replacing the backup needs re-auth (step 5)

  // SP-14-02: a restored backup that predates KDF v3 (or an older OPRF seed
  // version) is re-wrapped right away with the secret just typed — only the
  // account password is asked for (re-auth). "Not now" keeps the old backup.
  const [upgradeSecret, setUpgradeSecret] = useState<string | null>(null)
  const [upgradePassword, setUpgradePassword] = useState('')

  useEffect(() => {
    if (!user) return

    // Check if server has an encrypted backup
    const timer = setTimeout(async () => {
      try {
        // Option B: a wrapped local key is only "there" once it unwraps.
        const { unlockLocalKeys } = await import('../../utils/e2e')
        if (await unlockLocalKeys(user.id)) return // keys already on this device

        // Shared background read (see readServerBackup) — not a restore attempt.
        const { readServerBackup } = await import('../../utils/e2e')
        const r = await readServerBackup(useAuthStore.getState().accessToken || '')
        if (!r.ok) return
        const { encrypted_private_key, nonce, salt } = r.data || {}
        // Only show if the backup is actually encrypted (has nonce + salt).
        // A legacy plain backup (pre-SP-1-01/02) is a migration case for
        // SP-1-04, not this modal — no backup at all is handled by ensureE2EKeys.
        if (encrypted_private_key && nonce && salt) {
          setShow(true)
        } else if (r.data?.backup_mode === 'max_privacy') {
          setMaxPrivacy(true); setMode('recovery'); setShow(true)
        }
      } catch {}
    }, 2000)

    return () => clearTimeout(timer)
  }, [user])

  // SP-1-14: manual re-entry after "Skip" — Settings/ChatRoom call
  // openPinModal() when this device has no local key yet, regardless of
  // whether the 2s auto-check above already ran.
  useEffect(() => {
    if (manualOpen) setShow(true)
  }, [manualOpen])

  async function handleEnter() {
    if (mode === 'pin' && !/^\d{6}$/.test(pin)) { setError(t('pin.enterYourPin')); return }
    if (mode === 'passphrase' && !passphrase) { setError(t('pin.enterYourPassphrase')); return }
    if (mode === 'recovery' && recoveryInput.replace(/\s/g, '').length < 60) { setError(t('pin.enterYourRecoveryKey')); return }
    setLoading(true)
    try {
      const res = await api.get('/users/me/e2e-keys')
      const { identity_key, encrypted_private_key, nonce, salt, recovery_encrypted, recovery_nonce, oprf_version, backup_mode } = res.data.data

      let ok = false
      if (backup_mode === 'max_privacy') {
        const { restoreWithMaxPrivacyKey } = await import('../../utils/e2e')
        ok = await restoreWithMaxPrivacyKey(user!.id, recoveryInput, identity_key)
        if (ok) { notifyKeysRestored(); toast.success(t('pin.chatKeysRestoredToast')); setShow(false); onComplete?.(); return }
      } else if (mode === 'recovery') {
        if (!recovery_encrypted || !recovery_nonce) { setError(t('pin.noRecoveryKeySetUp')); setLoading(false); return }
        const { restoreWithRecoveryKey } = await import('../../utils/e2e')
        ok = await restoreWithRecoveryKey(user!.id, recoveryInput, recovery_encrypted, recovery_nonce, identity_key)
      } else {
        const { restoreWithPassphrase } = await import('../../utils/e2e')
        ok = await restoreWithPassphrase(user!.id, mode === 'passphrase' ? passphrase : pin, encrypted_private_key, nonce, salt, accessToken || undefined)
      }

      if (!ok) {
        setError(mode === 'recovery' ? t('pin.wrongRecoveryKey') : mode === 'passphrase' ? t('pin.wrongPassphrase') : t('pin.wrongPin'))
        setPin(''); setLoading(false); return
      }

      notifyKeysRestored() // hides "Enter PIN" affordances everywhere else on this device
      toast.success(t('pin.chatKeysRestoredToast'))
      if (mode === 'recovery') { setNewPinStep(true); return }
      const { backupNeedsUpgrade } = await import('../../utils/e2e')
      if (backupNeedsUpgrade(salt, oprf_version)) { setUpgradeSecret(mode === 'passphrase' ? passphrase : pin); return }
      setShow(false)
      onComplete?.()
    } catch (err: any) {
      // Two guess limits answer 429: the backup fetch (5 / 15 min) and, for
      // KDF v3, the PIN OPRF itself (8 / hour, 24 / day — SP-14-02).
      if (err?.response?.status === 429 || err?.status === 429) {
        setError(t('pin.tooManyAttempts'))
      } else {
        setError(t('pin.couldNotRestoreKeys'))
      }
      setPin('')
    } finally { setLoading(false) }
  }

  async function handleForgotReset() {
    if (!forgotConfirmed) { setForgotError(t('pin.confirmCannotBeUndone')); return }
    if (!forgotPassword) { setForgotError(t('pin.enterAccountPassword')); return }
    setForgotError('')
    setForgotLoading(true)
    try {
      // Fresh re-auth (SP-0-05) before any destructive key action.
      await api.post('/auth/reauth', { password: forgotPassword })
      const { resetE2EKeys } = await import('../../utils/e2e')
      const ok = await resetE2EKeys(user!.id, accessToken || '')
      if (!ok) { setForgotError(t('pin.couldNotResetCheckPassword')); setForgotLoading(false); return }
      // A full page reload gives ensureE2EKeys a clean slate to generate and
      // register a fresh keypair, then SecureChatsPrompt picks up from there.
      window.location.reload()
    } catch (err: any) {
      setForgotError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain'))
      setForgotLoading(false)
    }
  }

  async function handleSetNewPin() {
    if (!/^\d{6}$/.test(newPin)) { setError(t('settings.enterNewPin')); return }
    if (newPin !== newPinConfirm) { setError(t('settings.newPinMismatch')); return }
    if (!newPinPassword) { setError(t('pin.enterAccountPassword')); return }
    setLoading(true)
    try {
      try { await api.post('/auth/reauth', { password: newPinPassword }) } catch (err: any) {
        setError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain')); return
      }
      const { protectChatKeyBackup } = await import('../../utils/e2e')
      if ((await protectChatKeyBackup(user!.id, newPin, accessToken || '')) !== 'ok') { setError(t('pin.couldNotSecureChats')); return }
      toast.success(t('settings.pinChanged'))
      setShow(false)
      onComplete?.()
    } finally { setLoading(false) }
  }

  async function handleUpgrade() {
    if (!upgradeSecret) return
    if (!upgradePassword) { setError(t('pin.enterAccountPassword')); return }
    setLoading(true)
    try {
      try { await api.post('/auth/reauth', { password: upgradePassword }) } catch (err: any) {
        setError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain')); return
      }
      const { upgradeChatBackup } = await import('../../utils/e2e')
      let ok = false
      try { ok = await upgradeChatBackup(user!.id, upgradeSecret, accessToken || '') } catch (err: any) {
        setError(err?.status === 429 ? t('pin.tooManyAttempts') : t('pin.somethingWentWrongTryAgain')); return
      }
      if (!ok) { setError(t('pin.somethingWentWrongTryAgain')); return }
      toast.success(t('pin.backupUpgradedToast'))
      finishUpgrade()
    } finally { setLoading(false) }
  }

  function finishUpgrade() {
    setUpgradeSecret(null); setUpgradePassword(''); setShow(false)
    onComplete?.()
  }

  function switchMode(next: Mode) {
    setMode(next); setError(''); setPin(''); setPassphrase(''); setRecoveryInput('')
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
          <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
            style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '32px 28px', maxWidth: 420, width: '100%' }}>

            {upgradeSecret !== null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                <Lock size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
                <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t('pin.upgradeBackupTitle')}</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6, textAlign: 'center' }}>{t('pin.upgradeBackupBody')}</p>
                <input type="password" value={upgradePassword} onChange={e => { setUpgradePassword(e.target.value); setError('') }} autoFocus
                  placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')}
                  style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleUpgrade} disabled={loading}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                  {loading ? t('pin.upgradingEllipsis') : t('pin.upgradeBackupButton')}
                </motion.button>
                <button onClick={finishUpgrade} disabled={loading}
                  style={{ padding: '8px', borderRadius: 12, fontSize: 13, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer' }}>
                  {t('pwa.notNow')}
                </button>
              </div>
            ) : newPinStep ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                <Lock size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
                <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t('pin.setNewPinTitle')}</h2>
                <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6, textAlign: 'center' }}>{t('pin.setNewPinBody')}</p>
                <div style={{ fontSize: 12.5, color: 'var(--text3)', alignSelf: 'flex-start' }}>{t('settings.newPinLabel')}</div>
                <PinInput value={newPin} onChange={v => { setNewPin(v); setError('') }} autoFocus error={!!error} />
                <div style={{ fontSize: 12.5, color: 'var(--text3)', alignSelf: 'flex-start' }}>{t('settings.confirmNewPinLabel')}</div>
                <PinInput value={newPinConfirm} onChange={v => { setNewPinConfirm(v); setError('') }} error={!!error} />
                <div style={{ fontSize: 12.5, color: 'var(--text3)', textAlign: 'center' }}>{t('settings.chatKeyPasswordHint')}</div>
                <input type="password" value={newPinPassword} onChange={e => { setNewPinPassword(e.target.value); setError('') }}
                  placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')}
                  style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleSetNewPin} disabled={loading}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                  {loading ? t('pin.securingEllipsis') : t('pin.setNewPinButton')}
                </motion.button>
              </div>
            ) : showForgot ? (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <TriangleAlert size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 10, color: 'var(--warning-text)' }} />
                  <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                    {t('pin.resetYourChatPin')}
                  </h2>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger-strong)', fontSize: 12.5, lineHeight: 1.6, marginBottom: 16 }}>
                  {t('pin.resetWarningBody')}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={forgotConfirmed} onChange={e => { setForgotConfirmed(e.target.checked); setForgotError('') }}
                      style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--danger-strong)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>{t('pin.iUnderstandCannotBeUndone')}</span>
                  </label>

                  <input type="password" value={forgotPassword}
                    onChange={e => { setForgotPassword(e.target.value); setForgotError('') }}
                    placeholder={t('pin.accountPasswordPlaceholder')} autoFocus
                    style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: `1.5px solid ${forgotError ? 'var(--danger)' : 'var(--input-border)'}`, borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />

                  {forgotError && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{forgotError}</div>}

                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={handleForgotReset}
                    disabled={forgotLoading}
                    style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--danger-fill)', color: '#fff', border: 'none', cursor: 'pointer', opacity: forgotLoading ? 0.7 : 1 }}>
                    {forgotLoading ? t('pin.resettingEllipsis') : t('pin.permanentlyResetButton')}
                  </motion.button>

                  <button onClick={() => { setShowForgot(false); setForgotPassword(''); setForgotConfirmed(false); setForgotError('') }}
                    style={{ width: '100%', padding: '10px', minHeight: 44, borderRadius: 12, fontSize: 13, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer' }}>
                    <ArrowLeft size={16} aria-hidden style={{ verticalAlign: '-3px' }} /> {t('pin.goBack')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <Lock size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 10, color: 'var(--link)' }} />
                  <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                    {maxPrivacy ? t('pin.maxPrivacyRestoreTitle') : t('pin.enterChatPinToUnlockMessages')}
                  </h2>
                  <p style={{ fontSize: 13.5, color: 'var(--text3)', lineHeight: 1.6 }}>
                    {maxPrivacy ? t('pin.maxPrivacyRestoreBody') : t('pin.restoreExplainer')}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
                  {mode === 'pin' && <PinInput value={pin} onChange={v => { setPin(v); setError('') }} autoFocus error={!!error} />}
                  {mode === 'passphrase' && (
                    <input type="password" value={passphrase}
                      onChange={e => { setPassphrase(e.target.value); setError('') }}
                      placeholder={t('pin.yourPassphrasePlaceholder')} autoFocus
                      style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: `1.5px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`, borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                  )}
                  {mode === 'recovery' && (
                    <textarea value={recoveryInput}
                      onChange={e => { setRecoveryInput(e.target.value); setError('') }}
                      placeholder={t('pin.recoveryKeyPlaceholder')} autoFocus rows={3}
                      style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: `1.5px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`, borderRadius: 10, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'monospace', resize: 'none' }} />
                  )}

                  {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}

                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={handleEnter}
                    disabled={loading}
                    style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)', opacity: loading ? 0.7 : 1 }}>
                    {loading ? t('pin.restoringEllipsis') : t('pin.restoreMyChatsButton')}
                  </motion.button>

                  {!maxPrivacy && <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                    {mode !== 'pin' && (
                      <button onClick={() => switchMode('pin')}
                        style={{ flex: 1, padding: '4px', borderRadius: 12, fontSize: 12, background: 'transparent', color: 'var(--link)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        {t('pin.use6DigitPin')}
                      </button>
                    )}
                    {mode !== 'passphrase' && (
                      <button onClick={() => switchMode('passphrase')}
                        style={{ flex: 1, padding: '4px', borderRadius: 12, fontSize: 12, background: 'transparent', color: 'var(--link)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        {t('pin.usePassphrase')}
                      </button>
                    )}
                    {mode !== 'recovery' && (
                      <button onClick={() => switchMode('recovery')}
                        style={{ flex: 1, padding: '4px', borderRadius: 12, fontSize: 12, background: 'transparent', color: 'var(--link)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        {t('pin.useRecoveryKey')}
                      </button>
                    )}
                  </div>}

                  <button onClick={() => { setShow(false); closePinModal() }}
                    style={{ width: '100%', padding: '10px', borderRadius: 12, fontSize: 13, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer' }}>
                    {t('pin.skipEnterLater')}
                  </button>

                  <button onClick={() => setShowForgot(true)}
                    style={{ width: '100%', padding: '4px', borderRadius: 12, fontSize: 11.5, background: 'transparent', color: 'var(--text4)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    {t('pin.forgotPinNoRecovery')}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
