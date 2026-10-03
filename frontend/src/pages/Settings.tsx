// src/pages/Settings.tsx
import { useState, useEffect, useRef } from 'react'
import { Check, Download, Hash, Key, KeyRound, Lock, PauseCircle, ShieldOff, Signal, Trash2, TriangleAlert, Type, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import { usePinModalStore } from '../stores/pinModalStore'
import { useDataSaverStore } from '../stores/dataSaverStore'
import Avatar from '../components/ui/Avatar'
import { userApi, authApi, api } from '../utils/api'
import { clearE2EKeys, protectChatKeyBackup, changeChatPin, generateRecoveryKey, hasKeys, readServerBackup, maxPrivacyKey, setMaxPrivacy, unlockLocalKeys } from '../utils/e2e'
import PinInput from '../components/chat/PinInput'
import CopyButton from '../components/ui/CopyButton'
import toast from 'react-hot-toast'
import { useT } from '../i18n/useT'
import { SUPPORTED_UI_LANGUAGES, type StringKey } from '../i18n/strings'
import Lockup from '../components/ui/Lockup'
import VerifyEmailPrompt from '../components/auth/VerifyEmailPrompt'
import InterestPicker from '../components/onboarding/InterestPicker'

// SP-11-09A: desc holds the StringKey (not the English text) since THEMES is
// a module-level constant outside the component — t() is called at render.
const THEMES: { id: string; name: string; desc: StringKey; colors: string[] }[] = [
  { id: 'heritage-sunset', name: 'Heritage Sunset', desc: 'settings.themeHeritageSunsetDesc', colors: ['#FF9F1C', '#7C3AED', '#FEF9F3'] },
  { id: 'heritage-sunset-dark', name: 'Heritage Sunset (Dark)', desc: 'settings.themeHeritageSunsetDarkDesc', colors: ['#FF9F1C', '#A78BFA', '#171329'] },
  { id: 'saffron', name: 'Warm Saffron', desc: 'settings.themeSaffronDesc', colors: ['#FF7A1A', '#1A0050', '#FFFAF5'] },
  { id: 'aurora',  name: 'Midnight Aurora', desc: 'settings.themeAuroraDesc', colors: ['#00D4B4', '#FF5066', '#080B14'] },
  { id: 'ink',     name: 'Ink + Lime', desc: 'settings.themeInkDesc',  colors: ['#C8F135', '#0D1117', '#F7F9FC'] },
]

const SECTIONS = ['Appearance', 'Account', 'Interests', 'Privacy', 'Notifications', 'Security', 'Data & Privacy', 'About']
const SECTION_LABEL_KEYS: Record<string, StringKey> = {
  'Appearance': 'settings.appearance', 'Account': 'settings.account', 'Interests': 'settings.interests', 'Privacy': 'settings.privacy',
  'Notifications': 'settings.notifications',
  'Security': 'settings.security', 'Data & Privacy': 'settings.dataPrivacy', 'About': 'settings.about',
}

export default function Settings() {
  const user     = useAuthStore(s => s.user)
  const setTheme = useAuthStore(s => s.setTheme)
  const setUser  = useAuthStore(s => s.setUser)
  const logout   = useAuthStore(s => s.logout)
  const accessToken = useAuthStore(s => s.accessToken)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const openPinModal = usePinModalStore(s => s.openPinModal)
  // Subscribing here forces this component to re-render the instant keys are
  // restored (via this page's own "Enter PIN" button, or ChatRoom's, or the
  // auto-popup) so the button below disappears live, not just on remount.
  usePinModalStore(s => s.keysVersion)
  const dataSaver = useDataSaverStore(s => s.enabled)
  const setDataSaverEnabled = useDataSaverStore(s => s.setEnabled)

  async function handleEasyModeChange(next: boolean) {
    try {
      await userApi.update({ easy_mode: next })
      setUser({ easy_mode: next })
    } catch {
      toast.error(t('settings.easyModeError'))
    }
  }

  const [section, setSection] = useState('Appearance')
  const t = useT()
  const [loading, setLoading] = useState(false)

  // Password change
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwError, setPwError] = useState('')

  // 2FA
  const [totpSecret, setTotpSecret] = useState('')
  const [totpCode, setTotpCode]     = useState('')
  const [show2FA, setShow2FA]       = useState(false)

  // Sessions (SP-11-04)
  const [sessions, setSessions]   = useState<any[]>([])
  const [showSessions, setShowSessions] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [revokingAllOthers, setRevokingAllOthers] = useState(false)

  // SP-11-01: Interests — the SAME InterestPicker component onboarding
  // uses, driven by the same PUT /users/me/interests endpoint. Loaded
  // lazily the first time this section is opened, not on every mount.
  const [interests, setInterests] = useState<Set<string>>(new Set())
  const [interestsLoaded, setInterestsLoaded] = useState(false)
  const [savingInterests, setSavingInterests] = useState(false)

  // SP-11-02: muted accounts + muted keywords — lazily loaded the first
  // time the Privacy section is opened, same pattern as Interests above.
  const [mutedAccounts, setMutedAccounts] = useState<any[]>([])
  const [mutedAccountsLoaded, setMutedAccountsLoaded] = useState(false)
  const [mutedKeywords, setMutedKeywords] = useState<string[]>([])
  const [mutedKeywordsLoaded, setMutedKeywordsLoaded] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')
  const [savingKeywords, setSavingKeywords] = useState(false)

  // SP-11-03: granular privacy settings — lazily loaded, edited locally,
  // saved via one explicit Save button (Section 52 — one atomic PUT for
  // the whole form, never a separate write per dropdown).
  const [privacy, setPrivacy] = useState({
    comments_from: 'everyone', mentions_from: 'everyone', friend_requests_from: 'everyone',
    followers_visibility: 'everyone', following_visibility: 'everyone',
  })
  const [privacyLoaded, setPrivacyLoaded] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState(false)

  // SP-11-05: per-type notification-delivery preferences — same lazy-load,
  // local-edit, one-atomic-Save pattern as privacy above.
  const [notifPrefs, setNotifPrefs] = useState({
    likes_enabled: true, comments_enabled: true, replies_enabled: true, mentions_enabled: true,
    follows_enabled: true, friend_requests_enabled: true, messages_enabled: true, event_quiz_enabled: true,
  })
  const [notifPrefsLoaded, setNotifPrefsLoaded] = useState(false)
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false)

  // SP-4-06: DPDP data export
  const [dataExport, setDataExport] = useState<{ id: string; status: string } | null>(null)
  const [exportLoading, setExportLoading] = useState(false)

  // Delete/deactivate
  const [showDeactivate, setShowDeactivate] = useState(false)
  const [showDelete, setShowDelete]         = useState(false)
  const [confirmText, setConfirmText]       = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deactivateConfirm, setDeactivateConfirm] = useState(false)
  const [showE2EBackup, setShowE2EBackup] = useState(false)
  const [e2ePass, setE2EPass] = useState('')
  const [e2eConfirm, setE2EConfirm] = useState('')

  // SP-1-05: Change PIN + Recovery key
  const [showChangePin, setShowChangePin] = useState(false)
  // SP-14-05: 'max_privacy' hides the backup-based controls (no backup exists)
  const [backupMode, setBackupMode] = useState<string | null>(null)
  useEffect(() => {
    if (!accessToken) return
    readServerBackup(accessToken).then(r => { if (r.ok) setBackupMode(r.data?.backup_mode || 'standard') }).catch(() => {})
  }, [accessToken])
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [changePinError, setChangePinError] = useState('')
  // Wave 3A step 5: changing the key backup / recovery key needs a fresh re-auth.
  const [chatKeyPassword, setChatKeyPassword] = useState('')
  const [showRecoveryAuth, setShowRecoveryAuth] = useState(false)
  const [recoveryAuthError, setRecoveryAuthError] = useState('')
  const [showRecoveryKey, setShowRecoveryKey] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [recoverySaved, setRecoverySaved] = useState(false)

  async function handleThemeChange(theme: string) {
    // Real bug fixed here (2026-07-27): this used to swallow a failed save
    // and still show a success toast, so the theme visually changed for the
    // current session (local state + localStorage) but was never persisted
    // — the next login would silently revert to the last theme that DID
    // save. Root cause was on the backend (a stale allowed-theme whitelist
    // that never learned about heritage-sunset/-dark), fixed there too, but
    // this UI must never lie about success regardless.
    const previous = user?.theme
    setTheme(theme)
    try {
      await userApi.update({ theme })
      toast.success(t('settings.themeChanged', { theme }))
    } catch {
      if (previous) setTheme(previous)
      toast.error(t('settings.themeSaveError'))
    }
  }

  async function handlePrivacyToggle(field: string, value: boolean) {
    try {
      await userApi.update({ [field]: value })
      setUser({ [field]: value } as any)
      toast.success(t('settings.updated'))
    } catch { toast.error(t('settings.toggleSaveError')) }
  }

  async function handlePasswordChange() {
    setPwError('')
    if (!pwForm.current || !pwForm.newPw) { setPwError(t('settings.allFieldsRequired')); return }
    if (pwForm.newPw.length < 8) { setPwError(t('settings.passwordMinLength')); return }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(pwForm.newPw)) { setPwError(t('settings.passwordComplexity')); return }
    if (pwForm.newPw !== pwForm.confirm) { setPwError(t('auth.error.passwordMismatch')); return }
    setLoading(true)
    try {
      await api.post('/auth/change-password', { current_password: pwForm.current, new_password: pwForm.newPw })
      setPwForm({ current: '', newPw: '', confirm: '' })
      toast.success(t('settings.passwordChangedSuccess'))
    } catch (err: any) {
      setPwError(err.response?.data?.error || t('settings.passwordChangeFailed'))
    } finally { setLoading(false) }
  }

  async function setup2FA() {
    setLoading(true)
    try {
      const res = await authApi.setup2fa()
      setTotpSecret(res.data.data.secret)
      setShow2FA(true)
    } catch { toast.error(t('settings.setup2faError')) }
    finally { setLoading(false) }
  }

  async function confirm2FA() {
    if (!totpCode || totpCode.length !== 6) { toast.error(t('settings.enter6DigitCode')); return }
    setLoading(true)
    try {
      await authApi.confirm2fa(totpCode)
      setUser({ totp_enabled: true } as any)
      setShow2FA(false)
      toast.success(t('settings.twoFaEnabled'))
    } catch { toast.error(t('settings.twoFaWrongCode')) }
    finally { setLoading(false) }
  }

  async function disable2FA() {
    const code = prompt(t('settings.disable2faCodePrompt'))
    const pass = prompt(t('settings.confirmPasswordPrompt'))
    if (!code || !pass) return
    try {
      await authApi.disable2fa({ totp_code: code, password: pass })
      setUser({ totp_enabled: false } as any)
      toast.success(t('settings.twoFaDisabled'))
    } catch { toast.error(t('settings.twoFaDisableError')) }
  }

  // SP-15-28: fetches fresh server truth and expands — called on every
  // open/reopen, never trusting a stale local `sessions` array (Section
  // 39: revocations/logins from other devices since the last view must be
  // reflected). A failed fetch leaves the list collapsed with the existing
  // error toast — it must never render a stale list as if the load
  // succeeded (Section 43).
  async function loadSessions() {
    if (sessionsLoading) return // guard against duplicate fetch spam
    setSessionsLoading(true)
    try {
      const res = await authApi.sessions()
      setSessions(res.data.data)
      setShowSessions(true)
    } catch { toast.error(t('settings.deviceLoadError')) }
    finally { setSessionsLoading(false) }
  }

  // SP-15-28: real toggle semantics — collapsing is pure local UI state and
  // must never call the session API (Section 38); expanding always
  // re-fetches via loadSessions. This is the fix for the shipped SP-11-04
  // regression where the button's onClick was unconditionally loadSessions,
  // which unconditionally ended in setShowSessions(true) — there was no
  // code path back to false, so "Hide devices" never actually collapsed.
  async function toggleSessions() {
    if (showSessions) { setShowSessions(false); return }
    await loadSessions()
  }

  // SP-11-04 Section 25: truthful failure handling — a failed revoke never
  // optimistically removes the device row; only a real 200 does.
  async function revokeSession(id: string) {
    try {
      await authApi.revokeSession(id)
      setSessions(s => s.filter(x => x.id !== id))
      toast.success(t('settings.deviceLogOutSuccess'))
    } catch { toast.error(t('settings.deviceLogOutError')) }
  }

  async function revokeAllOtherSessions() {
    if (!window.confirm(t('settings.deviceLogOutAllOthersConfirm'))) return
    setRevokingAllOthers(true)
    try {
      await authApi.revokeAllOtherSessions()
      setSessions(s => s.filter(x => x.is_current))
      toast.success(t('settings.deviceLogOutAllOthersSuccess'))
    } catch {
      toast.error(t('settings.deviceLogOutAllOthersError'))
    } finally {
      setRevokingAllOthers(false)
    }
  }

  function deviceLocationLabel(s: any): string {
    const parts = [s.location_city, s.location_region, s.location_country].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : t('settings.deviceUnknownLocation')
  }

  // SP-11-04 Section 11: current-device logout reuses the canonical
  // POST /auth/logout flow (no `all_devices` flag — that's the separate
  // "Sign out from all devices" action below) — never a second endpoint.
  async function handleLogout() {
    try { await authApi.logout() } catch { /* cookies are cleared client-side regardless */ }
    logout()
    navigate('/login')
  }

  async function handleDeactivate() {
    if (!deactivateConfirm) return
    setLoading(true)
    try {
      await api.post('/auth/deactivate')
      clearE2EKeys(user!.id)
      logout()
      navigate('/login')
      toast.success(t('settings.deactivatedSuccess'))
    } catch { toast.error(t('settings.deactivateError')) }
    finally { setLoading(false) }
  }

  async function handlePermanentDelete() {
    if (confirmText !== 'DELETE') { toast.error(t('settings.typeDeleteConfirm')); return }
    if (!deletePassword) { toast.error(t('settings.enterPasswordConfirm')); return }
    setLoading(true)
    try {
      // SP-4-05: delete-account requires a fresh re-auth grant, same
      // pattern as key rotation/reset — a stolen access token alone must
      // not be able to schedule account destruction.
      await api.post('/auth/reauth', { password: deletePassword })
      await api.delete('/auth/delete-account')
      clearE2EKeys(user!.id)
      logout()
      navigate('/login')
      toast.success(t('settings.deletionScheduled'))
    } catch (err: any) {
      const msg = err?.response?.data?.error
      toast.error(msg === 'Re-authentication failed' ? t('settings.incorrectPassword') : t('settings.deleteAccountError'))
    }
    finally { setLoading(false) }
  }

  // SP-4-06: DPDP data export — request kicks off the backend Workflow;
  // polling picks up 'ready' once it finishes (typically seconds, but a
  // large media library could take longer, hence the poll rather than a
  // single fixed-delay check).
  const exportPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    checkExportStatus()
    return () => { if (exportPollRef.current) clearInterval(exportPollRef.current) }
  }, [])

  async function checkExportStatus() {
    try {
      const res = await api.get('/users/me/export')
      const latest = res.data?.data?.[0]
      setDataExport(latest ? { id: latest.id, status: latest.status } : null)
      if (latest && (latest.status === 'pending' || latest.status === 'processing') && !exportPollRef.current) {
        exportPollRef.current = setInterval(async () => {
          const poll = await api.get('/users/me/export')
          const p = poll.data?.data?.[0]
          if (p) setDataExport({ id: p.id, status: p.status })
          if (!p || (p.status !== 'pending' && p.status !== 'processing')) {
            if (exportPollRef.current) { clearInterval(exportPollRef.current); exportPollRef.current = null }
          }
        }, 5000)
      }
    } catch { /* best-effort status check */ }
  }

  useEffect(() => {
    if (section !== 'Interests' || interestsLoaded) return
    userApi.onboarding()
      .then(res => { setInterests(new Set(res.data?.data?.selected_interests || [])); setInterestsLoaded(true) })
      .catch(() => setInterestsLoaded(true))
  }, [section, interestsLoaded])

  useEffect(() => {
    if (section !== 'Privacy') return
    if (!mutedAccountsLoaded) {
      userApi.mutes()
        .then(res => { setMutedAccounts(res.data?.data || []); setMutedAccountsLoaded(true) })
        .catch(() => setMutedAccountsLoaded(true))
    }
    if (!mutedKeywordsLoaded) {
      userApi.mutedKeywords()
        .then(res => { setMutedKeywords(res.data?.data || []); setMutedKeywordsLoaded(true) })
        .catch(() => setMutedKeywordsLoaded(true))
    }
    if (!privacyLoaded) {
      userApi.privacy()
        .then(res => { if (res.data?.data) setPrivacy(res.data.data); setPrivacyLoaded(true) })
        .catch(() => setPrivacyLoaded(true))
    }
  }, [section, mutedAccountsLoaded, mutedKeywordsLoaded, privacyLoaded])

  // SP-11-05: loaded lazily the first time the Notifications section is opened.
  useEffect(() => {
    if (section !== 'Notifications' || notifPrefsLoaded) return
    userApi.notificationPreferences()
      .then(res => { if (res.data?.data) setNotifPrefs(res.data.data); setNotifPrefsLoaded(true) })
      .catch(() => setNotifPrefsLoaded(true))
  }, [section, notifPrefsLoaded])

  async function saveNotifPrefs() {
    setSavingNotifPrefs(true)
    try {
      const res = await userApi.saveNotificationPreferences(notifPrefs)
      if (res.data?.data) setNotifPrefs(res.data.data)
      toast.success(t('settings.notificationsSaved'))
    } catch {
      toast.error(t('settings.notificationsSaveError'))
    } finally {
      setSavingNotifPrefs(false)
    }
  }

  async function savePrivacy() {
    setSavingPrivacy(true)
    try {
      const res = await userApi.savePrivacy(privacy)
      if (res.data?.data) setPrivacy(res.data.data)
      invalidateContentQueries()
      toast.success(t('settings.privacySaved'))
    } catch {
      toast.error(t('settings.notificationsSaveError'))
    } finally {
      setSavingPrivacy(false)
    }
  }

  function invalidateContentQueries() {
    for (const key of ['feed', 'explore', 'stories', 'suggestions', 'saved']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
  }

  async function handleUnmuteAccount(username: string) {
    const previous = mutedAccounts
    setMutedAccounts(prev => prev.filter(u => u.username !== username)) // optimistic
    try {
      await userApi.unmute(username)
      invalidateContentQueries()
      toast.success(t('settings.unmute'))
    } catch {
      setMutedAccounts(previous) // failure restores truthful state, never a false success
      toast.error(t('settings.unmuteError'))
    }
  }

  async function saveMutedKeywords(next: string[]) {
    setSavingKeywords(true)
    const previous = mutedKeywords
    try {
      const res = await userApi.saveMutedKeywords(next)
      setMutedKeywords(res.data?.data?.keywords || next)
      invalidateContentQueries()
    } catch {
      setMutedKeywords(previous)
      toast.error(t('settings.notificationsSaveError'))
    } finally {
      setSavingKeywords(false)
    }
  }

  function handleAddKeyword() {
    const value = newKeyword.trim()
    if (!value) return
    setNewKeyword('')
    void saveMutedKeywords([...mutedKeywords, value])
  }

  function handleRemoveKeyword(keyword: string) {
    void saveMutedKeywords(mutedKeywords.filter(k => k !== keyword))
  }

  function toggleInterest(key: string) {
    setInterests(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function saveInterests() {
    setSavingInterests(true)
    try {
      await userApi.saveInterests([...interests])
      toast.success(t('settings.interestsSaved'))
    } catch { toast.error(t('settings.interestsSaveError')) }
    finally { setSavingInterests(false) }
  }

  async function requestDataExport() {
    setExportLoading(true)
    try {
      const res = await api.post('/users/me/export')
      setDataExport({ id: res.data.data.id, status: res.data.data.status })
      toast.success(t('settings.exportRequested'))
      checkExportStatus()
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('settings.exportRequestError'))
    } finally { setExportLoading(false) }
  }

  async function downloadDataExport() {
    if (!dataExport) return
    setExportLoading(true)
    try {
      const res = await api.get(`/users/me/export/${dataExport.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `spandik-data-export-${dataExport.id}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch { toast.error(t('settings.exportDownloadError')) }
    finally { setExportLoading(false) }
  }

  async function protectE2EBackup() {
    if (!user?.id || !accessToken) return
    if (e2ePass.length < 10) { toast.error(t('settings.passphraseMinLength')); return }
    if (e2ePass !== e2eConfirm) { toast.error(t('settings.passphraseMismatch')); return }
    setLoading(true)
    try {
      const result = await protectChatKeyBackup(user.id, e2ePass, accessToken)
      if (result !== 'ok') { toast.error(t('settings.backupProtectError')); return }
      setShowE2EBackup(false)
      setE2EPass('')
      setE2EConfirm('')
      toast.success(t('settings.backupProtected'))
    } finally {
      setLoading(false)
    }
  }

  async function handleChangePin() {
    setChangePinError('')
    if (!/^\d{6}$/.test(oldPin)) { setChangePinError(t('settings.enterCurrentPin')); return }
    if (!/^\d{6}$/.test(newPin)) { setChangePinError(t('settings.enterNewPin')); return }
    if (newPin !== newPinConfirm) { setChangePinError(t('settings.newPinMismatch')); return }
    if (!chatKeyPassword) { setChangePinError(t('pin.enterAccountPassword')); return }
    if (!user?.id || !accessToken) return
    setLoading(true)
    try {
      if (!(await reauthWithPassword(chatKeyPassword, setChangePinError))) return
      let ok = false
      try { ok = await changeChatPin(user.id, oldPin, newPin, accessToken) } catch (err: any) {
        // SP-14-02: the PIN-guess limit (OPRF) — not a wrong PIN
        setChangePinError(err?.status === 429 ? t('pin.tooManyAttempts') : t('pin.somethingWentWrongTryAgain')); return
      }
      if (!ok) { setChangePinError(t('settings.currentPinIncorrect')); return }
      setShowChangePin(false)
      setOldPin(''); setNewPin(''); setNewPinConfirm(''); setChatKeyPassword('')
      toast.success(t('settings.pinChanged'))
    } finally {
      setLoading(false)
    }
  }

  async function reauthWithPassword(password: string, setError: (e: string) => void): Promise<boolean> {
    try {
      await api.post('/auth/reauth', { password })
      return true
    } catch (err: any) {
      setError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain'))
      return false
    }
  }

  async function handleGenerateRecoveryKey() {
    if (!user?.id || !accessToken) return
    if (!chatKeyPassword) { setRecoveryAuthError(t('pin.enterAccountPassword')); return }
    setLoading(true)
    try {
      if (!(await reauthWithPassword(chatKeyPassword, setRecoveryAuthError))) return
      setShowRecoveryAuth(false); setChatKeyPassword('')
      const key = await generateRecoveryKey(user.id, accessToken)
      if (!key) { toast.error(t('settings.recoveryKeyGenError')); return }
      setRecoveryKey(key)
      setRecoverySaved(false)
      setShowRecoveryKey(true)
    } finally {
      setLoading(false)
    }
  }

  const privacyToggles = [
    { field: 'show_email',  label: t('settings.showEmail'),  value: (user as any)?.show_email },
    { field: 'show_phone',  label: t('settings.showPhone'),  value: (user as any)?.show_phone },
    { field: 'show_dob',    label: t('settings.showDob'),    value: (user as any)?.show_dob },
    { field: 'show_gender', label: t('settings.showGender'), value: (user as any)?.show_gender },
    { field: 'show_bio',    label: t('settings.showBio'),    value: (user as any)?.show_bio },
    { field: 'allow_dm',    label: t('settings.allowDm'),    value: (user as any)?.allow_dm },
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px 60px' }}>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>{t('settings.pageTitle')}</h1>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 24, scrollbarWidth: 'none', paddingBottom: 2 }}>
        {SECTIONS.map(s => (
          <button key={s} onClick={() => setSection(s)}
            style={{ flexShrink: 0, padding: '7px 14px', minHeight: 44, borderRadius: 99, background: section === s ? 'var(--btn-primary-bg)' : 'var(--bg2)', color: section === s ? 'var(--btn-primary-text)' : 'var(--text3)', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s' }}>
            {t(SECTION_LABEL_KEYS[s])}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

          {/* ── APPEARANCE ── */}
          {section === 'Appearance' && (
            <div>
              {/* SP-5-07: Easy Mode — per-account (PATCH /users/me), applied
                  app-wide only after the server confirms it. */}
              <div style={{ marginBottom: 20 }}>
                <InfoCard icon={<Type size={20} aria-hidden />} title={t('settings.easyMode')} desc={t('settings.easyModeDesc')}>
                  <Toggle value={!!user?.easy_mode} onChange={handleEasyModeChange} label={t('settings.easyMode')} />
                </InfoCard>
              </div>
              <SectionLabel>{t('settings.theme')}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {THEMES.map(theme => (
                  <motion.button key={theme.id} whileTap={{ scale: 0.98 }}
                    onClick={() => handleThemeChange(theme.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, background: 'var(--white)', border: `2px solid ${user?.theme === theme.id ? 'var(--brand)' : 'var(--border)'}`, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {theme.colors.map((c, i) => <div key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.1)' }} />)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{theme.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text4)' }}>{t(theme.desc)}</div>
                    </div>
                    {user?.theme === theme.id && <Check size={20} aria-label={t('settings.themeSelected')} style={{ color: 'var(--link)' }} />}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* ── ACCOUNT ── */}
          {section === 'Account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionLabel>{t('settings.accountInfo')}</SectionLabel>
              <InfoRow label={t('auth.username')} value={`@${user?.username}`} />
              <InfoRow label={t('settings.email')} value={user?.email || ''} badge={user?.email_verified ? t('settings.verified') : t('settings.unverified')} />
              {user && !user.email_verified && (
                <div style={{ marginTop: 4 }}>
                  <VerifyEmailPrompt message={t('settings.verifyEmailMessage')} />
                </div>
              )}

              <SectionLabel style={{ marginTop: 8 }}>{t('settings.changePasswordTitle')}</SectionLabel>
              <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['current', t('settings.currentPassword'), t('settings.currentPassword')],
                  ['newPw',   t('settings.newPassword'), t('auth.passwordHint')],
                  ['confirm', t('settings.confirmNewPassword'), t('settings.reenterNewPassword')],
                ].map(([field, label, ph]) => (
                  <div key={field}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 5 }}>{label}</label>
                    <input type="password" value={(pwForm as any)[field]}
                      onChange={e => setPwForm(f => ({ ...f, [field]: e.target.value }))}
                      placeholder={ph}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13.5, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                  </div>
                ))}
                {pwError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{pwError}</div>}
                <motion.button whileTap={{ scale: 0.97 }} onClick={handlePasswordChange} disabled={loading}
                  style={{ padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                  {loading ? t('settings.changing') : t('settings.changePasswordBtn')}
                </motion.button>
              </div>

              <SectionLabel style={{ marginTop: 4 }}>{t('settings.language')}</SectionLabel>
              <select defaultValue={user?.preferred_lang}
                onChange={async e => { await userApi.update({ preferred_lang: e.target.value }); setUser({ preferred_lang: e.target.value } as any); toast.success(t('settings.languageUpdated')) }}
                style={{ padding: '10px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                {SUPPORTED_UI_LANGUAGES.map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── INTERESTS (SP-11-01) ── */}
          {section === 'Interests' && (
            <div>
              <SectionLabel>{t('settings.interests')}</SectionLabel>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.5 }}>{t('settings.interestsBody')}</p>
              <InterestPicker selected={interests} onToggle={toggleInterest} />
              <motion.button whileTap={{ scale: 0.97 }} onClick={saveInterests} disabled={savingInterests || !interestsLoaded}
                style={{ marginTop: 20, padding: '10px 22px', minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                {savingInterests ? t('settings.saving') : t('post.save')}
              </motion.button>
            </div>
          )}

          {/* ── PRIVACY ── */}
          {section === 'Privacy' && (
            <div>
              <SectionLabel>{t('settings.privacyControlsTitle')}</SectionLabel>
              {privacyToggles.map(t => (
                <div key={t.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid var(--divider)' }}>
                  <span style={{ fontSize: 14, color: 'var(--text2)' }}>{t.label}</span>
                  <Toggle value={!!t.value} onChange={v => handlePrivacyToggle(t.field, v)} label={t.label} />
                </div>
              ))}

              {/* ── Granular privacy settings (SP-11-03) ── */}
              <SectionLabel style={{ marginTop: 20 }}>{t('settings.privacyControls')}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {([
                  ['comments_from', 'settings.commentsFrom', ['everyone', 'friends', 'nobody']],
                  ['mentions_from', 'settings.mentionsFrom', ['everyone', 'friends', 'nobody']],
                  ['friend_requests_from', 'settings.friendRequestsFrom', ['everyone', 'friends_of_friends', 'nobody']],
                  ['followers_visibility', 'settings.followersVisibility', ['everyone', 'friends', 'only_me']],
                  ['following_visibility', 'settings.followingVisibility', ['everyone', 'friends', 'only_me']],
                ] as [keyof typeof privacy, StringKey, string[]][]).map(([field, labelKey, options]) => (
                  <div key={field}>
                    <label htmlFor={`privacy-${field}`} style={{ display: 'block', fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>{t(labelKey)}</label>
                    <select id={`privacy-${field}`} value={privacy[field]} onChange={e => setPrivacy(p => ({ ...p, [field]: e.target.value }))}
                      style={{ width: '100%', padding: '10px 12px', minHeight: 44, background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13.5, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                      {options.map(opt => (
                        <option key={opt} value={opt}>
                          {opt === 'everyone' ? t('settings.privacyEveryone')
                            : opt === 'friends' ? t('settings.privacyFriends')
                            : opt === 'friends_of_friends' ? t('settings.privacyFriendsOfFriends')
                            : opt === 'only_me' ? t('settings.privacyOnlyMe')
                            : t('settings.privacyNobody')}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <motion.button whileTap={{ scale: 0.97 }} onClick={savePrivacy} disabled={savingPrivacy || !privacyLoaded}
                  style={{ marginTop: 4, padding: '10px 22px', minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)', alignSelf: 'flex-start' }}>
                  {savingPrivacy ? t('settings.saving') : t('settings.privacySave')}
                </motion.button>
              </div>

              {/* ── Muted accounts (SP-11-02) ── */}
              <SectionLabel style={{ marginTop: 20 }}>{t('settings.mutedAccounts')}</SectionLabel>
              {mutedAccounts.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text4)', padding: '8px 0' }}>{t('settings.mutedAccountsEmpty')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mutedAccounts.map(u => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--divider)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar src={u.profile_pic_url} name={`${u.first_name} ${u.last_name}`} size={36} />
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{u.first_name} {u.last_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text4)' }}>@{u.username}</div>
                        </div>
                      </div>
                      <button onClick={() => handleUnmuteAccount(u.username)}
                        style={{ padding: '8px 14px', minHeight: 44, borderRadius: 99, fontSize: 12.5, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                        {t('settings.unmute')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Muted words (SP-11-02) ── */}
              <SectionLabel style={{ marginTop: 20 }}>{t('settings.mutedKeywords')}</SectionLabel>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>{t('settings.mutedKeywordsHelp')}</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword() } }}
                  placeholder={t('settings.mutedKeywordsPlaceholder')} maxLength={80}
                  style={{ flex: 1, padding: '10px 12px', minHeight: 44, background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13.5, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={handleAddKeyword} disabled={savingKeywords || !newKeyword.trim()}
                  style={{ padding: '10px 18px', minHeight: 44, borderRadius: 9, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                  {t('settings.mutedKeywordsAdd')}
                </button>
              </div>
              {mutedKeywords.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text4)' }}>{t('settings.mutedKeywordsEmpty')}</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {mutedKeywords.map(kw => (
                    <div key={kw} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 12px', minHeight: 44, borderRadius: 99, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{kw}</span>
                      <button onClick={() => handleRemoveKeyword(kw)} aria-label={t('settings.mutedKeywordsRemove')}
                        style={{ width: 44, height: 44, margin: -7, borderRadius: '50%', background: 'none', color: 'var(--text4)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={16} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── NOTIFICATIONS (SP-11-05) ── */}
          {section === 'Notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SectionLabel>{t('settings.notifications')}</SectionLabel>
              {([
                ['likes_enabled', 'settings.notifLikes'],
                ['comments_enabled', 'settings.notifComments'],
                ['replies_enabled', 'settings.notifReplies'],
                ['mentions_enabled', 'settings.notifMentions'],
                ['follows_enabled', 'settings.notifFollows'],
                ['friend_requests_enabled', 'settings.notifFriendRequests'],
                ['messages_enabled', 'settings.notifMessages'],
                ['event_quiz_enabled', 'settings.notifEventQuiz'],
              ] as [keyof typeof notifPrefs, StringKey][]).map(([field, labelKey]) => (
                <div key={field} style={{ background: 'var(--white)', borderRadius: 10, border: '1px solid var(--border)', padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t(labelKey)}</span>
                  <Toggle value={notifPrefs[field]} onChange={v => setNotifPrefs(p => ({ ...p, [field]: v }))} label={t(labelKey)} />
                </div>
              ))}
              <motion.button whileTap={{ scale: 0.97 }} onClick={saveNotifPrefs} disabled={savingNotifPrefs || !notifPrefsLoaded}
                style={{ marginTop: 4, padding: '12px 16px', minHeight: 44, borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                {savingNotifPrefs ? t('settings.saving') : t('settings.notificationsSave')}
              </motion.button>
            </div>
          )}

          {/* ── SECURITY ── */}
          {section === 'Security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionLabel>{t('settings.extraLoginCheck')}</SectionLabel>
              <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t('settings.authenticatorAppCodes')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text4)', marginTop: 2 }}>
                    {user?.totp_enabled ? t('settings.twoFaOnDesc') : t('settings.twoFaOffDesc')}
                  </div>
                </div>
                {user?.totp_enabled
                  ? <button onClick={disable2FA} style={{ padding: '7px 14px', minHeight: 44, borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--danger-bg)', color: 'var(--danger-strong)', border: 'none', cursor: 'pointer' }}>{t('settings.turnOff')}</button>
                  : <button onClick={setup2FA} disabled={loading} style={{ padding: '7px 14px', minHeight: 44, borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>{t('settings.turnOn')}</button>
                }
              </div>

              {show2FA && (
                <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t('settings.scanKeyInstruction')}</div>
                  <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', wordBreak: 'break-all' }}>{totpSecret}</div>
                  <input type="text" inputMode="numeric" maxLength={6} value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('settings.enter6DigitCodeConfirm')}
                    style={{ padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 20, fontWeight: 700, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', color: 'var(--text)', outline: 'none' }} />
                  <button onClick={confirm2FA} disabled={loading}
                    style={{ padding: '11px', minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                    {loading ? t('auth.verifying') : t('settings.turnOn')}
                  </button>
                </div>
              )}

              <SectionLabel style={{ marginTop: 4 }}>{t('settings.chatSecurity')}</SectionLabel>
              {backupMode !== 'max_privacy' && <>
              <InfoCard icon={<Hash size={20} aria-hidden />} title={t('settings.changeChatPinTitle')} desc={t('settings.changeChatPinDesc')}>
                <button style={actionBtn} onClick={() => setShowChangePin(true)}>{t('settings.changePinBtn')}</button>
              </InfoCard>
              <InfoCard icon={<KeyRound size={20} aria-hidden />} title={t('settings.recoveryKeyTitle')} desc={t('settings.recoveryKeyDesc')}>
                <button style={actionBtn} onClick={() => { setRecoveryAuthError(''); setShowRecoveryAuth(true) }} disabled={loading}>{t('settings.getRecoveryKeyBtn')}</button>
              </InfoCard>
              </>}
              {user?.id && hasKeys(user.id) && backupMode && accessToken && (
                <MaxPrivacySection userId={user.id} accessToken={accessToken} on={backupMode === 'max_privacy'}
                  onChange={on => { setBackupMode(on ? 'max_privacy' : 'standard'); if (!on) window.location.reload() }} />
              )}

              {user?.id && !hasKeys(user.id) && (
                <InfoCard icon={<Key size={20} aria-hidden />} title={t('settings.enterChatPinTitle')} desc={t('settings.enterChatPinDesc')}>
                  <button style={actionBtn} onClick={() => openPinModal()}>{t('settings.enterPinBtn')}</button>
                </InfoCard>
              )}

              <SectionLabel style={{ marginTop: 4 }}>{t('settings.devicesLoggedIn')}</SectionLabel>
              <button onClick={toggleSessions} disabled={sessionsLoading}
                aria-expanded={showSessions} aria-controls="device-list"
                style={{ padding: '11px 16px', minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--white)', color: 'var(--text)', border: '1px solid var(--border)', cursor: sessionsLoading ? 'default' : 'pointer', textAlign: 'left', opacity: sessionsLoading ? 0.7 : 1 }}>
                {showSessions ? t('settings.deviceHide') : t('settings.deviceViewAll')}
              </button>
              <div id="device-list">
                {showSessions && sessions.length > 1 && (
                  <button onClick={revokeAllOtherSessions} disabled={revokingAllOthers}
                    style={{ padding: '11px 16px', minHeight: 44, borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--danger-bg)', color: 'var(--danger-strong)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    {t('settings.deviceLogOutAllOthers')}
                  </button>
                )}
                {showSessions && sessions.map(s => (
                  <div key={s.id} style={{ background: 'var(--white)', borderRadius: 10, border: '1px solid var(--border)', padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {s.device_name || s.device_type} {s.is_current && <span style={{ color: 'var(--link)', fontSize: 11 }}>({t('settings.deviceThisDevice')})</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text4)' }}>
                        {deviceLocationLabel(s)} · {t('settings.deviceLastActive')} {deviceTimeAgo(s.last_active_at, t)}
                      </div>
                    </div>
                    <button onClick={() => s.is_current ? handleLogout() : revokeSession(s.id)}
                      style={{ padding: '5px 10px', minHeight: 44, borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--danger-bg)', color: 'var(--danger-strong)', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {s.is_current ? t('settings.deviceLogOutThisDevice') : t('settings.deviceLogOut')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DATA & PRIVACY ── */}
          {section === 'Data & Privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SectionLabel>{t('settings.yourDataYourControl')}</SectionLabel>
              <div style={{ fontSize: 12.5, color: 'var(--text4)', marginTop: -6, marginBottom: 4 }}>
                {t('settings.dpdpNotice')}
              </div>

              <InfoCard icon={<Signal size={20} aria-hidden />} title={t('settings.dataSaver')} desc={t('settings.dataSaverDesc')}>
                <Toggle value={dataSaver} onChange={setDataSaverEnabled} label={t('settings.dataSaver')} />
              </InfoCard>

              <InfoCard icon={<Download size={20} aria-hidden />} title={t('settings.downloadYourData')} desc={t('settings.exportDataDesc')}>
                {(!dataExport || dataExport.status === 'expired') && (
                  <button style={actionBtn} disabled={exportLoading} onClick={requestDataExport}>
                    {exportLoading ? t('settings.requesting') : t('settings.requestExport')}
                  </button>
                )}
                {dataExport && (dataExport.status === 'pending' || dataExport.status === 'processing') && (
                  <button style={{ ...actionBtn, cursor: 'default' }} disabled>{t('settings.preparingExport')}</button>
                )}
                {dataExport && dataExport.status === 'ready' && (
                  <button style={actionBtn} disabled={exportLoading} onClick={downloadDataExport}>
                    {exportLoading ? t('settings.downloading') : t('settings.downloadMyData')}
                  </button>
                )}
              </InfoCard>

              <InfoCard icon={<Lock size={20} aria-hidden />} title={t('settings.e2eTitle')} desc={t('settings.e2eDesc')}>
                <button style={actionBtn} onClick={() => setShowE2EBackup(true)}>{t('settings.protectBackupBtn')}</button>
              </InfoCard>

              <SectionLabel style={{ marginTop: 8, color: 'var(--warning-text)' }}>{t('settings.dangerZone')}</SectionLabel>

              <InfoCard icon={<PauseCircle size={20} aria-hidden />} title={t('settings.deactivateAccountTitle')} desc={t('settings.deactivateAccountDesc')}>
                <button style={{ ...actionBtn, background: 'var(--warning-bg)', color: 'var(--warning-text)', borderColor: 'var(--warning-text)' }}
                  onClick={() => setShowDeactivate(true)}>
                  {t('settings.deactivateBtn')}
                </button>
              </InfoCard>

              <InfoCard icon={<Trash2 size={20} aria-hidden />} title={t('settings.deleteAccountTitle')} desc={t('settings.deleteAccountDesc')}>
                <button style={{ ...actionBtn, background: 'var(--danger-bg)', color: 'var(--danger-strong)', borderColor: 'var(--danger-border)' }}
                  onClick={() => setShowDelete(true)}>
                  {t('settings.deleteBtn')}
                </button>
              </InfoCard>

              <div style={{ fontSize: 12, color: 'var(--text4)', lineHeight: 1.7, padding: '12px 14px', background: 'var(--bg2)', borderRadius: 10 }}>
                {t('settings.dpdpContact')}
              </div>
            </div>
          )}

          {/* ── ABOUT ── */}
          {section === 'About' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--border)', padding: 20, textAlign: 'center' }}>
                <Lockup height={44} style={{ margin: '0 auto 10px' }} />
                {/* SP-5-16: "Version X · © year, {t('brand.attribution')}" — the
                    full legal entity name, matching the exact phrase SP-4-08
                    already established on the legal pages (no wording drift). */}
                <div style={{ fontSize: 11.5, color: 'var(--text4)' }}>{t('settings.versionLine', { year: String(new Date().getFullYear()), brand: t('brand.attribution') })}</div>
              </div>
              {[{ label: t('auth.consentTermsLink'), path: '/terms' }, { label: t('auth.consentPrivacyLink'), path: '/privacy' }, { label: t('settings.grievanceRedressal'), path: '/legal/grievance' }].map(item => (
                <button key={item.label} onClick={() => navigate(item.path)}
                  style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--white)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--text)', display: 'flex', justifyContent: 'space-between' }}>
                  {item.label} <span style={{ color: 'var(--text4)' }}>→</span>
                </button>
              ))}
              <a href="mailto:support@spandik.com"
                style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--white)', border: '1px solid var(--border)', textAlign: 'left', fontSize: 14, color: 'var(--text)', display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}>
                {t('brand.contactSupport')} <span style={{ color: 'var(--text4)' }}>→</span>
              </a>
              <button onClick={async () => {
                try { await authApi.logout({ all_devices: true }) } catch {}
                logout()
                navigate('/login')
              }}
                style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: 'var(--danger-strong)', fontWeight: 700 }}>
                {t('settings.signOutAllDevices')}
              </button>
            </div>
          )}

        </motion.div>
      </AnimatePresence>

      {/* ── E2E BACKUP MODAL ── */}
      <AnimatePresence>
        {showE2EBackup && (
          <Modal onClose={() => { setShowE2EBackup(false); setE2EPass(''); setE2EConfirm('') }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <Lock size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{t('settings.protectChatBackupTitle')}</h2>
              <p style={{ fontSize: 13, color: 'var(--text4)', lineHeight: 1.6, marginTop: 8 }}>
                {t('settings.protectChatBackupDesc')}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="password" value={e2ePass} onChange={e => setE2EPass(e.target.value)}
                placeholder={t('settings.passphrasePlaceholder')}
                style={{ padding: '11px 13px', borderRadius: 10, border: '1.5px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', outline: 'none' }} />
              <input type="password" value={e2eConfirm} onChange={e => setE2EConfirm(e.target.value)}
                placeholder={t('settings.confirmPassphrasePlaceholder')}
                style={{ padding: '11px 13px', borderRadius: 10, border: '1.5px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', outline: 'none' }} />
              <button onClick={protectE2EBackup} disabled={loading}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? t('settings.protecting') : t('settings.protectBackupBtn')}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* ── CHANGE PIN MODAL ── */}
      <AnimatePresence>
        {showChangePin && (
          <Modal onClose={() => { setShowChangePin(false); setOldPin(''); setNewPin(''); setNewPinConfirm(''); setChangePinError(''); setChatKeyPassword('') }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <Hash size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{t('settings.changeChatPinTitle')}</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textAlign: 'center' }}>{t('settings.currentPinLabel')}</label>
                <PinInput value={oldPin} onChange={v => { setOldPin(v); setChangePinError('') }} autoFocus error={!!changePinError} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textAlign: 'center' }}>{t('settings.newPinLabel')}</label>
                <PinInput value={newPin} onChange={v => { setNewPin(v); setChangePinError('') }} error={!!changePinError} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, textAlign: 'center' }}>{t('settings.confirmNewPinLabel')}</label>
                <PinInput value={newPinConfirm} onChange={v => { setNewPinConfirm(v); setChangePinError('') }} error={!!changePinError} />
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', textAlign: 'center' }}>{t('settings.chatKeyPasswordHint')}</div>
              <input type="password" value={chatKeyPassword} onChange={e => { setChatKeyPassword(e.target.value); setChangePinError('') }}
                placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')}
                style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
              {changePinError && <div style={{ fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{changePinError}</div>}
              <button onClick={handleChangePin} disabled={loading}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? t('settings.changing') : t('settings.changePinBtn')}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* ── RECOVERY KEY: password first (Wave 3A step 5) ── */}
      <AnimatePresence>
        {showRecoveryAuth && (
          <Modal onClose={() => { setShowRecoveryAuth(false); setChatKeyPassword(''); setRecoveryAuthError('') }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t('settings.recoveryKeyTitle')}</h2>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', textAlign: 'center' }}>{t('settings.chatKeyPasswordHint')}</div>
              <input type="password" value={chatKeyPassword} onChange={e => { setChatKeyPassword(e.target.value); setRecoveryAuthError('') }}
                placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')}
                style={{ width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
              {recoveryAuthError && <div style={{ fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{recoveryAuthError}</div>}
              <button onClick={handleGenerateRecoveryKey} disabled={loading}
                style={{ padding: '12px', borderRadius: 10, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {t('settings.getRecoveryKeyBtn')}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* ── RECOVERY KEY MODAL ── */}
      <AnimatePresence>
        {showRecoveryKey && (
          <Modal onClose={() => { if (recoverySaved) { setShowRecoveryKey(false); setRecoveryKey('') } }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <KeyRound size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--link)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{t('settings.yourRecoveryKeyTitle')}</h2>
              <p style={{ fontSize: 13, color: 'var(--text4)', lineHeight: 1.6, marginTop: 8 }}>
                {t('settings.recoveryKeyScreenshotHint')}
              </p>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, letterSpacing: 1, color: 'var(--text)', wordBreak: 'break-all', textAlign: 'center' }}>
                {recoveryKey}
              </div>
              <CopyButton text={recoveryKey} label={t('settings.copyRecoveryKeyLabel')} />
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger-strong)', fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}>
              {t('settings.recoveryKeyLossWarning')}
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12.5, lineHeight: 1.6, marginBottom: 16 }}>
              {t('settings.recoveryKeyReplaceWarning')}
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 14 }}>
              <input type="checkbox" checked={recoverySaved} onChange={e => setRecoverySaved(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--brand)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>{t('settings.recoveryKeySavedConfirm')}</span>
            </label>
            <button disabled={!recoverySaved}
              onClick={() => { setShowRecoveryKey(false); setRecoveryKey('') }}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, cursor: recoverySaved ? 'pointer' : 'not-allowed', opacity: recoverySaved ? 1 : 0.5 }}>
              {t('settings.done')}
            </button>
          </Modal>
        )}
      </AnimatePresence>

      {/* ── DEACTIVATE MODAL ── */}
      <AnimatePresence>
        {showDeactivate && (
          <Modal onClose={() => { setShowDeactivate(false); setDeactivateConfirm(false) }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40 }}>⏸️</div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{t('settings.deactivateAccountTitle')}</h2>
            </div>
            <div style={{ background: 'var(--warning-bg)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: 'var(--warning-text)', lineHeight: 1.6, marginBottom: 16 }}>
              <TriangleAlert size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {t('settings.deactivateModalWarning1')}<br />
              {t('settings.deactivateModalWarning2')} <strong>{t('settings.days14')}</strong> {t('settings.deactivateModalWarning3')}
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={deactivateConfirm} onChange={e => setDeactivateConfirm(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--brand)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                {t('settings.deactivateCheckboxLabel')}
              </span>
            </label>
            <button onClick={handleDeactivate} disabled={!deactivateConfirm || loading}
              style={{ width: '100%', padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: deactivateConfirm ? 'var(--warning-fill)' : 'var(--bg2)', color: deactivateConfirm ? '#fff' : 'var(--text4)', border: 'none', cursor: deactivateConfirm ? 'pointer' : 'default', transition: 'all 0.2s' }}>
              {loading ? t('settings.deactivating') : t('settings.deactivateMyAccount')}
            </button>
          </Modal>
        )}
      </AnimatePresence>

      {/* ── PERMANENT DELETE MODAL ── */}
      <AnimatePresence>
        {showDelete && (
          <Modal onClose={() => { setShowDelete(false); setConfirmText(''); setDeletePassword('') }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <TriangleAlert size={40} strokeWidth={1.5} aria-hidden style={{ color: 'var(--danger-strong)' }} />
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--danger-strong)', marginTop: 8 }}>{t('settings.deleteAccountTitle')}</h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6, marginBottom: 16 }}>
              {t('settings.deleteModalWarning1')} <strong>{t('settings.deleteModalImmediately')}</strong>{t('settings.deleteModalWarning2')} <strong>{t('settings.days14')}</strong> {t('settings.deleteModalWarning3')} <strong>{t('settings.deleteModalPermanent')}</strong>.
            </p>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>{t('settings.confirmPasswordPrompt')}</p>
            {/* SP-11-09A: "Password"/"DELETE" placeholders and the literal
                DELETE keyword below are left untranslated — confirmText is
                compared against the literal string 'DELETE' in handlePermanentDelete,
                so the word the user must type cannot change per language. */}
            <input type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} placeholder={t('auth.password')}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--danger-border)', borderRadius: 9, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }} />
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>{t('settings.typeWord')} <strong>DELETE</strong> {t('settings.toConfirmColon')}</p>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="DELETE"
              style={{ width: '100%', padding: '10px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--danger-border)', borderRadius: 9, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }} />
            <button onClick={handlePermanentDelete} disabled={loading}
              style={{ width: '100%', padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--danger-fill)', color: '#fff', border: 'none', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? t('settings.deleting') : t('settings.deleteMyAccount')}
            </button>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

// SP-11-04: same small per-file convention as Buzz.tsx/PostDetail.tsx's own
// timeAgo — not centralized, matching this codebase's established pattern.
// SP-11-09A: takes `t` (this module-level function has no hook access of its
// own) so the "ago" text is translated — smallest change per the i18n brief.
function deviceTimeAgo(d: string, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - new Date(d).getTime()
  if (diff < 60000) return t('settings.justNow')
  if (diff < 3600000) return t('settings.minutesAgo', { n: String(Math.floor(diff / 60000)) })
  if (diff < 86400000) return t('settings.hoursAgo', { n: String(Math.floor(diff / 3600000)) })
  return t('settings.daysAgo', { n: String(Math.floor(diff / 86400000)) })
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, ...style }}>{children}</div>
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--divider)' }}>
      <span style={{ fontSize: 13, color: 'var(--text3)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
        {badge && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--link)', background: 'var(--brand-light)', padding: '2px 6px', borderRadius: 4 }}>{badge}</span>}
      </div>
    </div>
  )
}

function InfoCard({ icon, title, desc, children }: any) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 14, border: '1px solid var(--border)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flex: 1 }}>
        <span style={{ flexShrink: 0, display: 'flex', color: 'var(--text3)', marginTop: 1 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text4)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  // Visual track stays a conventional switch size; the tap target (a
  // transparent padded hit-area) meets the 44px minimum without making the
  // switch itself look oversized. role="switch" + aria-checked + aria-label
  // make this a real accessible control, not just a styled div — and give
  // Playwright a stable `getByRole('switch', { name: label })` target
  // instead of relying on DOM structure.
  return (
    <div role="switch" aria-checked={value} aria-label={label} tabIndex={0}
      onClick={() => onChange(!value)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!value) } }}
      style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
      <motion.div
        style={{ width: 44, height: 24, borderRadius: 12, background: value ? 'var(--brand)' : 'var(--border)', position: 'relative' }}>
        <motion.div animate={{ x: value ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={{ position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </motion.div>
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const t = useT()
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '28px 24px', maxWidth: 420, width: '100%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', fontSize: 13, fontWeight: 600, minWidth: 44, minHeight: 44, justifyContent: 'center', cursor: 'pointer', color: 'var(--text4)' }}><X size={16} aria-hidden />{t('overlay.close')}</button>
        {children}
      </motion.div>
    </motion.div>
  )
}

// SP-14-05 — "Maximum privacy": no copy of the chat key on the server at all.
// Turning it on shows the user's own key first and needs it typed back (last
// 8 characters) plus the account password; turning it off needs the password
// and then a new Chat PIN (SecureChatsPrompt, after the reload).
function MaxPrivacySection({ userId, accessToken, on, onChange }: { userId: string; accessToken: string; on: boolean; onChange: (on: boolean) => void }) {
  const t = useT()
  const [open, setOpen] = useState<null | 'enable' | 'disable' | 'show'>(null)
  const [key, setKey] = useState('')
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input: React.CSSProperties = { width: '100%', padding: '11px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }
  const primary: React.CSSProperties = { padding: '12px', borderRadius: 10, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.7 : 1 }

  async function start(which: 'enable' | 'disable' | 'show') {
    await unlockLocalKeys(userId)
    setKey(maxPrivacyKey(userId) || ''); setConfirm(''); setPassword(''); setError(''); setOpen(which)
  }
  function close() { setOpen(null); setKey(''); setPassword('') }

  async function submit() {
    if (open === 'enable' && confirm.replace(/\s/g, '').toUpperCase() !== key.slice(-8)) { setError(t('settings.maxPrivacyConfirmMismatch')); return }
    if (!password) { setError(t('pin.enterAccountPassword')); return }
    setBusy(true)
    try {
      try { await api.post('/auth/reauth', { password }) } catch (err: any) {
        setError(err?.response?.status === 401 ? t('pin.incorrectPassword') : t('pin.somethingWentWrongTryAgain')); return
      }
      if (open === 'show') { setOpen('show'); setPassword(''); setError(''); setConfirm('shown'); return }
      if (!(await setMaxPrivacy(userId, open === 'enable', accessToken))) { setError(t('pin.somethingWentWrongTryAgain')); return }
      toast.success(open === 'enable' ? t('settings.maxPrivacyOnToast') : t('settings.maxPrivacyOffToast'))
      const nowOn = open === 'enable'
      close(); onChange(nowOn)
    } finally { setBusy(false) }
  }

  const showKey = open === 'enable' || (open === 'show' && confirm === 'shown')
  return (
    <>
      <InfoCard icon={<ShieldOff size={20} aria-hidden />} title={on ? t('settings.maxPrivacyOnTitle') : t('settings.maxPrivacyTitle')} desc={on ? t('settings.maxPrivacyOnDesc') : t('settings.maxPrivacyDesc')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {on && <button style={actionBtn} onClick={() => start('show')}>{t('settings.maxPrivacyShowKey')}</button>}
          <button style={actionBtn} onClick={() => start(on ? 'disable' : 'enable')} aria-label={on ? t('settings.maxPrivacyOffTitle') : t('settings.maxPrivacyEnableBtn')}>{on ? t('settings.turnOff') : t('settings.turnOn')}</button>
        </div>
      </InfoCard>
      <AnimatePresence>
        {open && (
          <Modal onClose={close}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
                {open === 'disable' ? t('settings.maxPrivacyOffTitle') : open === 'show' ? t('settings.maxPrivacyYourKey') : t('settings.maxPrivacyTitle')}
              </h2>
              {open === 'enable' && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger-strong)', fontSize: 12.5, lineHeight: 1.6 }}>{t('settings.maxPrivacyWarning')}</div>
              )}
              {open === 'disable' && <p style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>{t('settings.maxPrivacyOffBody')}</p>}
              {showKey && (
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div data-testid="max-privacy-key" style={{ flex: 1, fontFamily: 'monospace', fontSize: 14, letterSpacing: 1, color: 'var(--text)', wordBreak: 'break-all', textAlign: 'center' }}>{key}</div>
                  <CopyButton text={key} label={t('settings.copyRecoveryKeyLabel')} />
                </div>
              )}
              {open === 'enable' && (
                <input value={confirm} onChange={e => { setConfirm(e.target.value); setError('') }} placeholder={t('settings.maxPrivacyConfirmPlaceholder')}
                  aria-label={t('settings.maxPrivacyConfirmPlaceholder')} autoCapitalize="characters" style={{ ...input, fontFamily: 'monospace' }} />
              )}
              {!(open === 'show' && confirm === 'shown') && (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', textAlign: 'center' }}>{t('settings.chatKeyPasswordHint')}</div>
                  <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                    placeholder={t('pin.accountPasswordPlaceholder')} aria-label={t('pin.accountPasswordPlaceholder')} style={input} />
                </>
              )}
              {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', textAlign: 'center' }}>{error}</div>}
              {open === 'show' && confirm === 'shown'
                ? <button onClick={close} style={primary}>{t('settings.done')}</button>
                : <button onClick={submit} disabled={busy} style={primary}>
                    {open === 'enable' ? t('settings.maxPrivacyEnableBtn') : open === 'disable' ? t('settings.turnOff') : t('settings.maxPrivacyShowKey')}
                  </button>}
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

const actionBtn: React.CSSProperties = {
  padding: '7px 14px', minHeight: 44, borderRadius: 8, fontSize: 12, fontWeight: 600,
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
}
