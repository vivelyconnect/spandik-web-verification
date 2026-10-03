// src/pages/auth/Register.tsx
import { useState, useRef, useEffect } from 'react'
import { Check, Lock, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { m as motion, AnimatePresence } from 'framer-motion'
import { authApi, refreshAccessToken } from '../../utils/api'
import { setCsrfProof } from '../../utils/csrf'
import { useAuthStore } from '../../stores/authStore'
import { ensureE2EKeys, initE2EWithPin } from '../../utils/e2e'
import PinInput from '../../components/chat/PinInput'
import Turnstile, { type TurnstileHandle } from '../../components/ui/Turnstile'
import toast from 'react-hot-toast'
import strings, { SUPPORTED_UI_LANGUAGES, translate, type Lang, type StringKey } from '../../i18n/strings'
import { useLangReady } from '../../i18n/useT'
import Lockup from '../../components/ui/Lockup'

// SP-15-23: registration's own translator, deliberately NOT useT()/useLang()
// — at this point in the flow no account exists yet (and even mid-flow, no
// user record to read a saved preference from), so the only real signal is
// the form's own local `preferred_lang` state, driven live by the picker.
// Reuses the shared `strings` dictionary directly (SP-5-06) rather than a
// separate registration-only copy of it — same lookup/fallback logic
// `useT()` uses, just parameterized by the form's language instead of the
// logged-in user's. A plain function of the current render's `form.preferred_lang`
// (not memoized) so every keystroke on the picker re-renders this component
// with a fresh translator — that's what makes switching live.
function registerT(lang: Lang) {
  return (key: StringKey, vars?: Record<string, string>) => translate(lang, key, vars)
}

// Known server error strings (api/src/routes/auth.ts / services/otp.ts) —
// the API never localizes its own error text, so registration maps the
// exact strings it can produce to a translation key. An error the server
// returns that isn't in this map still shows (in English, via the
// generic-error fallback the caller already applies) rather than being lost.
const SERVER_ERROR_KEYS: Record<string, StringKey> = {
  'Username already taken': 'auth.error.usernameTaken',
  'Email already registered': 'auth.error.emailTaken',
  'Verification failed. Please try again.': 'auth.error.turnstileFailed',
  'Invalid or expired code': 'auth.error.codeInvalid',
  'Code expired. Request a new one.': 'auth.error.codeExpired',
  'Too many attempts. Request a new code.': 'auth.error.tooManyAttempts',
  'Code already used': 'auth.error.codeUsed',
}

function calculateAge(dob: string): number {
  const today = new Date()
  const birth = new Date(dob)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6,
}

function Err({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{children}</div>
}

function Input({ label, error, ...props }: any) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'var(--input-bg)',
          border: `1.5px solid ${error ? 'var(--danger)' : focused ? 'var(--brand)' : 'var(--input-border)'}`,
          borderRadius: 10, fontSize: 14, color: 'var(--text)',
          outline: 'none', fontFamily: 'inherit',
          boxShadow: focused ? '0 0 0 3px var(--brand-light)' : 'none',
          transition: 'all 0.15s',
          ...props.style,
        }}
      />
      {error && <Err>{error}</Err>}
    </div>
  )
}

export default function Register() {
  const navigate = useNavigate()
  const setAuth  = useAuthStore(s => s.setAuth)
  const [step, setStep]       = useState<'form' | 'pin' | 'verify'>('form')
  const [loading, setLoading] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [resending, setResending] = useState(false)
  const [userData, setUserData]   = useState<any>(null)
  // Stable translation KEYS, never pre-rendered strings — that's what makes
  // an already-visible validation error switch language immediately on a
  // picker change, with no resubmission (SP-15-23 requirement).
  const [errors, setErrors]       = useState<Partial<Record<string, StringKey>>>({})
  const [pin, setPin]             = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError]   = useState<StringKey | ''>('')
  const [settingPin, setSettingPin] = useState(false)

  // SP-4-07: Turnstile — one widget on the signup form, one on the verify
  // step (only ever used for "Resend code", a separate OTP-request call).
  const [turnstileToken, setTurnstileToken] = useState('')
  const [resendTurnstileToken, setResendTurnstileToken] = useState('')
  const turnstileRef = useRef<TurnstileHandle>(null)
  const resendTurnstileRef = useRef<TurnstileHandle>(null)
  const [form, setForm] = useState({
    first_name: '', last_name: '', username: '', email: '',
    password: '', confirm_password: '', dob: '', gender: '',
    preferred_lang: 'en' as Lang, accepted_terms: false, accepted_age: false,
  })
  // SP-15-23: recomputed every render off the form's own local state, not
  // memoized away — the picker's onChange triggers a normal re-render, so
  // every consumer of `rt` below re-renders in the newly selected language
  // on the very next paint, with no extra plumbing.
  useLangReady(form.preferred_lang) // picker switches load hi/bn on demand
  const rt = registerT(form.preferred_lang)

  function set(field: string, value: any) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  // SP-15-24: live, debounced username availability — advisory only, the
  // server's own check-then-insert at submit time stays authoritative
  // (see auth.ts's race-safety fallback). `reasonCode` mirrors the API's
  // `reason_code` for 'unavailable'; unset for every other status.
  const [usernameCheck, setUsernameCheck] = useState<{
    status: 'idle' | 'checking' | 'available' | 'unavailable' | 'rate_limited' | 'error'
    reasonCode?: string
    suggestions: string[]
  }>({ status: 'idle', suggestions: [] })
  const usernameAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const typed = form.username.trim()
    // A non-empty but locally malformed username can never be available —
    // skip the network call entirely rather than spend a request on it.
    // An EMPTY username still triggers a (debounced) call once a first or
    // last name exists, purely to surface name-based suggestions before
    // the visitor has typed anything into the username field at all — the
    // one deliberate exception to "skip invalid input".
    const locallyMalformed = typed.length > 0 && !/^[a-zA-Z0-9_]{3,30}$/.test(typed)
    const nothingToCheck = typed.length === 0 && !form.first_name.trim() && !form.last_name.trim()
    if (locallyMalformed || nothingToCheck) {
      usernameAbortRef.current?.abort()
      setUsernameCheck({ status: 'idle', suggestions: [] })
      return
    }

    setUsernameCheck(s => ({ ...s, status: 'checking' }))
    const timer = setTimeout(async () => {
      usernameAbortRef.current?.abort()
      const controller = new AbortController()
      usernameAbortRef.current = controller
      try {
        const res = await authApi.usernameAvailability(typed, form.first_name.trim(), form.last_name.trim(), controller.signal)
        const { available, reason_code, suggestions } = res.data.data
        setUsernameCheck({
          status: available ? 'available' : 'unavailable',
          reasonCode: reason_code,
          suggestions: suggestions || [],
        })
      } catch (err: any) {
        // A superseded request's own abort rejects here too — ignore it,
        // the newer request in flight owns the state from here on.
        if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') return
        if (err.response?.status === 429) setUsernameCheck({ status: 'rate_limited', suggestions: [] })
        else setUsernameCheck({ status: 'error', suggestions: [] }) // network/timeout/5xx — never "available"/"taken"
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [form.username, form.first_name, form.last_name])

  function applySuggestion(suggestion: string) {
    set('username', suggestion)
  }

  const USERNAME_REASON_KEYS: Record<string, StringKey> = {
    taken: 'auth.usernameUnavailableTaken',
    reserved: 'auth.usernameUnavailableReserved',
    profanity: 'auth.usernameUnavailableProfanity',
    invalid_format: 'auth.error.usernameFormat',
  }

  function validate(): boolean {
    const e: Partial<Record<string, StringKey>> = {}
    if (!form.first_name.trim()) e.first_name = 'auth.error.required'
    if (!form.last_name.trim())  e.last_name  = 'auth.error.required'
    if (!form.username.trim())   e.username   = 'auth.error.required'
    else if (!/^[a-zA-Z0-9_]{3,30}$/.test(form.username))
      e.username = 'auth.error.usernameFormat'
    // The live check is advisory, but a definite "unavailable" result for
    // the exact value about to be submitted is real signal — surfacing it
    // here saves a guaranteed-failing round trip. Still just the client's
    // own gate: the server re-checks (and race-safely enforces) on submit
    // regardless of what this says.
    else if (usernameCheck.status === 'unavailable' && usernameCheck.reasonCode === 'taken')
      e.username = 'auth.error.usernameTaken'
    if (!form.email.trim()) e.email = 'auth.error.required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'auth.error.emailInvalid'
    if (!form.password) e.password = 'auth.error.required'
    else if (form.password.length < 8) e.password = 'auth.error.passwordMinLength'
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
      e.password = 'auth.error.passwordComplexity'
    if (form.password !== form.confirm_password) e.confirm_password = 'auth.error.passwordMismatch'
    if (!form.dob) e.dob = 'auth.error.required'
    else if (calculateAge(form.dob) < 18) e.dob = 'auth.error.ageMinimum'
    if (!form.accepted_terms) e.accepted_terms = 'auth.error.termsRequired'
    if (!form.accepted_age)   e.accepted_age   = 'auth.error.ageConfirmRequired'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  /** Maps a known server error string to its translation key; falls back to
   * the caller-supplied generic key for anything not in SERVER_ERROR_KEYS
   * (an unmapped server string still shows in English via that fallback,
   * rather than being silently lost). */
  function serverErrorText(rawError: string | undefined, fallbackKey: StringKey): string {
    const key = rawError ? SERVER_ERROR_KEYS[rawError] : undefined
    return key ? rt(key) : rt(fallbackKey)
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    if (!turnstileToken) { toast.error(rt('auth.completeVerificationWidget')); return }
    setLoading(true)
    try {
      const res = await authApi.register({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        username: form.username.toLowerCase().trim(),
        email: form.email.toLowerCase().trim(),
        password: form.password, dob: form.dob,
        gender: form.gender || null, preferred_lang: form.preferred_lang,
        accepted_terms: true,
        turnstile_token: turnstileToken,
      })
      // SP-15-27: establishes the frontend's CSRF proof right when
      // registration succeeds — both downstream paths that use `userData`
      // (skipVerify() and the verify-email success handler below) rely on
      // it having been set here; the verify-email path additionally rotates
      // it again via its own refreshAccessToken() call. See utils/csrf.ts.
      setCsrfProof(res.data.data.csrf_token)
      setUserData(res.data.data)
      setStep('pin')
    } catch (err: any) {
      toast.error(err.response
        ? serverErrorText(err.response?.data?.error, 'auth.registerGenericError')
        : rt('auth.networkError'))
      turnstileRef.current?.reset() // a Turnstile token is single-use — get a fresh one for the retry
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(pin)) { setPinError('auth.pinDigitsError'); return }
    if (pin !== pinConfirm) { setPinError('auth.pinMismatch'); return }
    setPinError('')
    setSettingPin(true)
    const { user, tokens } = userData
    const success = await initE2EWithPin(user.id, pin, tokens.access_token)
    setSettingPin(false)
    if (!success) { setPinError('auth.pinSetupFailed'); return }
    setPin(''); setPinConfirm('')
    setStep('verify')
    toast.success(rt('auth.accountCreatedToast'))
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!otpCode || otpCode.length !== 6) { toast.error(rt('auth.enterSixDigitCode')); return }
    setLoading(true)
    try {
      await authApi.verifyEmail({ email: form.email, code: otpCode })
      const { user, tokens, device_id } = userData
      // SP-15-05: the access token minted at registration still carries
      // email_verified:false baked into its claims — many actions (posting,
      // commenting, DMs, etc.) now check that claim server-side, so without
      // this the user would appear verified in the UI but keep getting 403s
      // until their token naturally expires (up to 15 minutes). Get a fresh
      // token immediately; fall back to the original one if the refresh call
      // itself fails — the normal 401-triggered refresh flow will retry.
      // SP-15-19: the refresh token itself is an HttpOnly cookie already set
      // by /auth/register's response, invisible here — refreshAccessToken()
      // reads it via that cookie automatically.
      let accessToken = tokens.access_token
      try {
        accessToken = await refreshAccessToken()
      } catch { /* keep the original access token; see comment above */ }
      setAuth({ ...user, email_verified: true }, accessToken, device_id)
      ensureE2EKeys(user.id, accessToken).catch(() => {})
      toast.success(rt('auth.emailVerifiedToast'))
      // SP-11-01: a brand-new account enters onboarding right after
      // security setup (Chat PIN/E2E + verify), never Home directly.
      navigate('/onboarding')
    } catch (err: any) {
      toast.error(err.response
        ? serverErrorText(err.response?.data?.error, 'auth.verifyFailedGeneric')
        : rt('auth.networkError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (!resendTurnstileToken) { toast.error(rt('auth.completeVerificationWidget')); return }
    setResending(true)
    try { await authApi.resendVerify(form.email, resendTurnstileToken); toast.success(rt('auth.resendSuccessToast')) }
    catch { toast.error(rt('auth.resendFailedToast')) }
    finally {
      setResending(false)
      resendTurnstileRef.current?.reset()
      setResendTurnstileToken('')
    }
  }

  function skipVerify() {
    const { user, tokens, device_id } = userData
    setAuth(user, tokens.access_token, device_id)
    ensureE2EKeys(user.id, tokens.access_token).catch(() => {})
    // SP-11-01: Verify Later still enters onboarding — interests/language/
    // profile can be set unverified; the follow step itself reuses
    // VerifyEmailPrompt and blocks on requireVerified server-side.
    navigate('/onboarding')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 400, height: 400, borderRadius: '50%', background: 'var(--brand)', opacity: 0.06, filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '-5%', width: 350, height: 350, borderRadius: '50%', background: 'var(--accent)', opacity: 0.06, filter: 'blur(80px)' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        style={{ width: '100%', maxWidth: 520, position: 'relative', zIndex: 1, background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '36px 36px 32px' }}>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Lockup height={50} style={{ margin: '0 auto' }} />
        </div>

        <AnimatePresence mode="wait">
          {step === 'form' ? (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>{rt('auth.createAccount')}</h1>

              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Input label={rt('auth.firstName')} value={form.first_name} error={errors.first_name && rt(errors.first_name)}
                    onChange={(e: any) => set('first_name', e.target.value)} placeholder={rt('auth.firstNamePlaceholder')} />
                  <Input label={rt('auth.lastName')} value={form.last_name} error={errors.last_name && rt(errors.last_name)}
                    onChange={(e: any) => set('last_name', e.target.value)} placeholder={rt('auth.lastNamePlaceholder')} />
                </div>

                <div>
                  <label style={labelStyle}>{rt('auth.username')}</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text4)', fontSize: 14 }}>@</span>
                    <input value={form.username} onChange={(e: any) => set('username', e.target.value.toLowerCase())}
                      placeholder={rt('auth.usernamePlaceholder')} autoComplete="username"
                      style={{
                        width: '100%', padding: '10px 14px 10px 28px', background: 'var(--input-bg)',
                        border: `1.5px solid ${errors.username ? 'var(--danger)'
                          : usernameCheck.status === 'unavailable' ? 'var(--danger)'
                          : usernameCheck.status === 'available' ? 'var(--success)'
                          : 'var(--input-border)'}`,
                        borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
                      }} />
                  </div>
                  {errors.username ? <Err>{rt(errors.username)}</Err> : (
                    <>
                      {usernameCheck.status === 'checking' && (
                        <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 4 }}>{rt('auth.usernameChecking')}</div>
                      )}
                      {usernameCheck.status === 'available' && (
                        <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={13} aria-hidden />{rt('auth.usernameAvailable')}</div>
                      )}
                      {usernameCheck.status === 'unavailable' && (
                        <Err>{rt(USERNAME_REASON_KEYS[usernameCheck.reasonCode || ''] || 'auth.usernameUnavailableTaken')}</Err>
                      )}
                      {usernameCheck.status === 'rate_limited' && (
                        <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 4 }}>{rt('auth.usernameRateLimited')}</div>
                      )}
                      {usernameCheck.status === 'error' && (
                        <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 4 }}>{rt('auth.usernameCheckError')}</div>
                      )}
                    </>
                  )}
                  {usernameCheck.status !== 'available' && usernameCheck.suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text4)' }}>{rt('auth.usernameSuggestionsLabel')}</span>
                      {usernameCheck.suggestions.map(s => (
                        <button key={s} type="button" onClick={() => applySuggestion(s)}
                          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--brand)', background: 'var(--brand-light)', border: 'none', borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>
                          @{s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Input label={rt('auth.email')} type="email" value={form.email} error={errors.email && rt(errors.email)}
                  onChange={(e: any) => set('email', e.target.value)} placeholder={rt('auth.emailPlaceholder')} />

                <Input label={rt('auth.password')} type="password" value={form.password} error={errors.password && rt(errors.password)}
                  onChange={(e: any) => set('password', e.target.value)}
                  placeholder={rt('auth.passwordHint')} autoComplete="new-password" />

                <Input label={rt('auth.confirmPassword')} type="password" value={form.confirm_password} error={errors.confirm_password && rt(errors.confirm_password)}
                  onChange={(e: any) => set('confirm_password', e.target.value)}
                  placeholder={rt('auth.confirmPasswordPlaceholder')} autoComplete="new-password" />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>{rt('auth.dob')} <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input type="date" value={form.dob}
                      max={new Date(Date.now() - 18 * 365.25 * 24 * 3600000).toISOString().split('T')[0]}
                      onChange={(e: any) => set('dob', e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: `1.5px solid ${errors.dob ? 'var(--danger)' : 'var(--input-border)'}`, borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                    {errors.dob && <Err>{rt(errors.dob)}</Err>}
                  </div>
                  <div>
                    <label style={labelStyle}>{rt('auth.gender')}</label>
                    <select value={form.gender} onChange={(e: any) => set('gender', e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                      <option value="">{rt('auth.genderPreferNotToSay')}</option>
                      <option value="male">{rt('auth.genderMale')}</option>
                      <option value="female">{rt('auth.genderFemale')}</option>
                      <option value="non_binary">{rt('auth.genderNonBinary')}</option>
                      <option value="other">{rt('auth.genderOther')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>{rt('auth.preferredLanguage')}</label>
                  <select value={form.preferred_lang} onChange={(e: any) => set('preferred_lang', e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                    {SUPPORTED_UI_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>

                {/* DPDP Consent */}
                <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {rt('auth.consentHeading')}
                  </div>

                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.accepted_terms}
                      onChange={e => set('accepted_terms', e.target.checked)}
                      style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--brand)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                      {rt('auth.consentTermsBefore')}{' '}
                      <Link to="/terms" target="_blank" style={{ color: 'var(--link)', fontWeight: 600 }}>{rt('auth.consentTermsLink')}</Link>
                      {' '}{rt('auth.consentTermsAnd')}{' '}
                      <Link to="/privacy" target="_blank" style={{ color: 'var(--link)', fontWeight: 600 }}>{rt('auth.consentPrivacyLink')}</Link>.{' '}
                      {rt('auth.consentTermsAfter')}
                    </span>
                  </label>
                  {errors.accepted_terms && <Err>{rt(errors.accepted_terms)}</Err>}

                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.accepted_age}
                      onChange={e => set('accepted_age', e.target.checked)}
                      style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--brand)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                      {rt('auth.consentAgePrefix')} <strong>{rt('auth.consentAgeBold')}</strong>. {rt('auth.consentAgeSuffix')}
                    </span>
                  </label>
                  {errors.accepted_age && <Err>{rt(errors.accepted_age)}</Err>}

                  <div style={{ fontSize: 11.5, color: 'var(--text4)', lineHeight: 1.6, borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
                    {rt('auth.dataNotice')}
                  </div>
                </div>

                <Turnstile ref={turnstileRef} action="register" onToken={setTurnstileToken} />

                <motion.button type="submit" disabled={loading || !turnstileToken} whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, boxShadow: 'var(--shadow-brand)', marginTop: 4 }}>
                  {loading ? rt('auth.creatingAccount') : rt('auth.createAccountButton')}
                </motion.button>
              </form>

              <div style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text3)' }}>
                {rt('auth.alreadyHaveAccount')}{' '}
                <Link to="/login" style={{ color: 'var(--link)', fontWeight: 700, textDecoration: 'none' }}>{rt('auth.signIn')}</Link>
              </div>
            </motion.div>
          ) : step === 'pin' ? (
            <motion.div key="pin" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Lock size={52} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--link)' }} />
                <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{rt('auth.setChatPinHeading')}</h2>
                <p style={{ fontSize: 14, color: 'var(--text3)', lineHeight: 1.6, padding: '0 8px' }}>
                  {rt('auth.pinCopy')}
                </p>
                {/* SP-1-02 Rule 5 compliance: always show the English original
                    alongside a translation, for this one security-critical
                    string — unchanged behavior, just driven by `rt` now. */}
                {form.preferred_lang !== 'en' && (
                  <p style={{ fontSize: 12, color: 'var(--text4)', lineHeight: 1.5, padding: '0 8px', marginTop: 8 }}>
                    {strings.en['auth.pinCopy']}
                  </p>
                )}
              </div>

              <form onSubmit={handleSetPin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ ...labelStyle, textAlign: 'center' }}>{rt('auth.enterPinLabel')}</label>
                  <PinInput value={pin} onChange={v => { setPin(v); setPinError('') }} autoFocus error={!!pinError} />
                </div>
                <div>
                  <label style={{ ...labelStyle, textAlign: 'center' }}>{rt('auth.confirmPinLabel')}</label>
                  <PinInput value={pinConfirm} onChange={v => { setPinConfirm(v); setPinError('') }} error={!!pinError} />
                </div>
                {pinError && <div style={{ textAlign: 'center' }}><Err>{rt(pinError)}</Err></div>}

                <motion.button type="submit" disabled={settingPin} whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: settingPin ? 'not-allowed' : 'pointer', opacity: settingPin ? 0.7 : 1, boxShadow: 'var(--shadow-brand)' }}>
                  {settingPin ? rt('auth.settingUpPin') : rt('auth.setPinButton')}
                </motion.button>

                <p style={{ fontSize: 11, color: 'var(--text4)', lineHeight: 1.5, textAlign: 'center' }}>
                  {rt('auth.recoveryPassphraseHint')}
                </p>
              </form>
            </motion.div>
          ) : (
            <motion.div key="verify" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <Mail size={52} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--link)' }} />
                <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{rt('auth.verifyEmailHeading')}</h2>
                <p style={{ fontSize: 14, color: 'var(--text3)', lineHeight: 1.6 }}>
                  {rt('auth.verifyEmailSubtext')}<br />
                  <strong style={{ color: 'var(--text)' }}>{form.email}</strong>
                </p>
              </div>

              <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <input type="text" inputMode="numeric" maxLength={6} value={otpCode} autoFocus
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  style={{ width: '100%', padding: '14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 12, fontSize: 32, fontWeight: 700, color: 'var(--text)', outline: 'none', textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace' }} />

                <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                  {loading ? rt('auth.verifying') : rt('auth.verifyEmailButton')}
                </motion.button>

                <div style={{ transform: 'scale(0.85)', transformOrigin: 'left' }}>
                  <Turnstile ref={resendTurnstileRef} action="resend_verification" onToken={setResendTurnstileToken} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button type="button" onClick={handleResend} disabled={resending || !resendTurnstileToken}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, minHeight: 44, padding: '0 4px', color: 'var(--link)', fontWeight: 600 }}>
                    {resending ? rt('auth.sendingCode') : rt('auth.resendCode')}
                  </button>
                  <button type="button" onClick={skipVerify}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, minHeight: 44, padding: '0 4px', color: 'var(--text4)' }}>
                    {rt('auth.verifyLater')}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SP-4-08: grievance mechanism must be reachable by anyone, not just
            logged-in users — previously only linked from authenticated Settings. */}
        <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
          {[{ label: 'Terms', path: '/terms' }, { label: 'Privacy', path: '/privacy' }, { label: 'Grievance Redressal', path: '/legal/grievance' }].map(item => (
            <Link key={item.path} to={item.path} target="_blank" style={{ fontSize: 11.5, color: 'var(--text4)', textDecoration: 'none' }}>
              {item.label}
            </Link>
          ))}
        </div>

        {/* SP-5-18: "from Vively" moved to the bottom, beneath the legal row
            — Instagram's "from Meta" pattern, shown once regardless of step. */}
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 10.5, color: 'var(--text4)' }}>
          {rt('brand.attributionShort')}
        </div>
      </motion.div>
    </div>
  )
}
