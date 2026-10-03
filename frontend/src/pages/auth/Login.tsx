// src/pages/auth/Login.tsx
import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { m as motion } from 'framer-motion'
import { authApi } from '../../utils/api'
import { setCsrfProof } from '../../utils/csrf'
import { useAuthStore } from '../../stores/authStore'
import Turnstile, { type TurnstileHandle } from '../../components/ui/Turnstile'
import toast from 'react-hot-toast'
import { markFreshLogin } from '../../components/welcome/WelcomeExperience'
import { useT } from '../../i18n/useT'
import Lockup from '../../components/ui/Lockup'

export default function Login() {
  const [form, setForm]       = useState({ login: '', password: '', totp_code: '' })
  const [loading, setLoading] = useState(false)
  const [needs2fa, setNeeds2fa] = useState(false)
  // SP-4-07: the backend only asks for Turnstile after 2 prior failures on
  // this login (see requires_turnstile in POST /auth/login) — never shown
  // up front, so a normal login stays completely frictionless.
  const [needsTurnstile, setNeedsTurnstile] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileRef = useRef<TurnstileHandle>(null)
  const navigate = useNavigate()
  const setAuth  = useAuthStore(s => s.setAuth)
  const t = useT()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await authApi.login({ ...form, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) })

      if (res.data.data.requires_turnstile) {
        setNeedsTurnstile(true)
        turnstileRef.current?.reset()
        setTurnstileToken('')
        setLoading(false)
        return
      }

      const { user, tokens, device_id, csrf_token } = res.data.data

      if (res.data.data.requires_2fa) {
        setNeeds2fa(true)
        setLoading(false)
        return
      }

      // SP-15-27: establishes the frontend's CSRF proof at the point login
      // actually succeeds — see utils/csrf.ts and utils/api.ts's
      // refreshAccessToken() for why this exists and how it's kept in sync.
      setCsrfProof(csrf_token)
      setAuth(user, tokens.access_token, device_id)
      // Silently ensure E2E keys exist so others can always send encrypted messages
      import('../../utils/e2e').then(m => m.ensureE2EKeys(user.id, tokens.access_token)).catch(() => {})
      markFreshLogin() // SP-5-11: one welcome sequence for this fresh login
      navigate('/')
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.signInGenericError'))
      if (needsTurnstile) { turnstileRef.current?.reset(); setTurnstileToken('') }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--white)',
          borderRadius: 20,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          padding: '40px 36px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Lockup height={56} style={{ margin: '0 auto' }} />
        </div>

        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 24 }}>
          {t('auth.welcomeBack')}
        </h1>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field
            label={t('auth.usernameOrEmail')}
            type="text"
            value={form.login}
            onChange={v => setForm(f => ({ ...f, login: v }))}
            placeholder={t('auth.usernameOrEmailPlaceholder')}
            autoComplete="username"
          />
          <Field
            label={t('auth.password')}
            type="password"
            value={form.password}
            onChange={v => setForm(f => ({ ...f, password: v }))}
            placeholder={t('auth.passwordPlaceholder')}
            autoComplete="current-password"
          />
          {needs2fa && (
            <Field
              label={t('settings.extraLoginCheck')}
              type="text"
              value={form.totp_code}
              onChange={v => setForm(f => ({ ...f, totp_code: v }))}
              placeholder={t('auth.authenticatorCodePlaceholder')}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Link to="/forgot" style={{ fontSize: 13, color: 'var(--link)', textDecoration: 'none', fontWeight: 600 }}>
              {t('auth.forgotPassword')}
            </Link>
          </div>

          {needsTurnstile && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 8 }}>
                {t('auth.fewFailedAttemptsTurnstile')}
              </div>
              <Turnstile ref={turnstileRef} action="login" onToken={setTurnstileToken} />
            </div>
          )}

          <motion.button
            type="submit"
            disabled={loading || (needsTurnstile && !turnstileToken)}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700,
              background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            {loading ? t('auth.signingInEllipsis') : t('auth.signIn')}
          </motion.button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: 'var(--text3)' }}>
          {t('auth.noAccount')}{' '}
          <Link to="/register" style={{ color: 'var(--link)', fontWeight: 700, textDecoration: 'none' }}>
            {t('auth.joinSpandik')}
          </Link>
        </div>

        {/* SP-4-08: the grievance mechanism must be reachable by anyone, not
            just logged-in users — this was previously only linked from the
            authenticated Settings page. */}
        <div style={{ textAlign: 'center', marginTop: 20, display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
          {[{ label: t('auth.termsLinkShort'), path: '/terms' }, { label: t('settings.privacy'), path: '/privacy' }, { label: t('auth.grievanceRedressalLink'), path: '/legal/grievance' }].map(item => (
            <Link key={item.path} to={item.path} style={{ fontSize: 11.5, color: 'var(--text4)', textDecoration: 'none' }}>
              {item.label}
            </Link>
          ))}
        </div>

        {/* SP-5-18: "from Vively" moved to the bottom, beneath the legal row
            — Instagram's "from Meta" pattern, never under the logo. */}
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 10.5, color: 'var(--text4)' }}>
          {t('brand.attributionShort')}
        </div>
      </motion.div>
    </div>
  )
}

// Shared field component
export function Field({ label, type, value, onChange, placeholder, autoComplete }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder?: string; autoComplete?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', padding: '10px 14px',
          background: 'var(--input-bg)',
          border: `1.5px solid ${focused ? 'var(--input-focus)' : 'var(--input-border)'}`,
          borderRadius: 10, fontSize: 14, color: 'var(--text)',
          outline: 'none', transition: 'border-color 0.15s',
          boxShadow: focused ? `0 0 0 3px var(--brand-light)` : 'none',
        }}
      />
    </div>
  )
}
