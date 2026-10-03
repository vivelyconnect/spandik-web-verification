// src/pages/auth/ForgotPassword.tsx
import { useState, useRef } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { m as motion, AnimatePresence } from 'framer-motion'
import { authApi } from '../../utils/api'
import Turnstile, { type TurnstileHandle } from '../../components/ui/Turnstile'
import Lockup from '../../components/ui/Lockup'
import { useT } from '../../i18n/useT'
import toast from 'react-hot-toast'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const t = useT()
  const [step, setStep]       = useState<'email' | 'otp' | 'reset'>('email')
  const [loading, setLoading] = useState(false)
  const [email, setEmail]     = useState('')
  const [otp, setOtp]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [errors, setErrors]       = useState<Record<string, string>>({})
  // SP-4-07: OTP request — every "send reset code" needs a fresh Turnstile pass
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileRef = useRef<TurnstileHandle>(null)

  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault()
    if (!email) { setErrors({ email: t('auth.emailRequired') }); return }
    if (!turnstileToken) { toast.error(t('auth.completeVerificationWidget')); return }
    setLoading(true)
    try {
      await authApi.forgotPassword(email, turnstileToken)
      toast.success(t('auth.resetCodeSentToast'))
      setStep('otp')
    } catch {
      toast.error(t('auth.resetCodeSendFailedToast'))
    } finally {
      setLoading(false)
      turnstileRef.current?.reset()
      setTurnstileToken('')
    }
  }

  function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault()
    if (!otp || otp.length !== 6) { setErrors({ otp: t('auth.enterSixDigitCode') }); return }
    setStep('reset')
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!password) errs.password = t('auth.error.required')
    else if (password.length < 8) errs.password = t('auth.error.passwordMinLength')
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) errs.password = t('auth.error.passwordUppercaseLowercaseNumber')
    if (password !== confirm) errs.confirm = t('auth.error.passwordMismatch')
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    try {
      await authApi.resetPassword({ email, code: otp, new_password: password })
      toast.success(t('auth.passwordResetSuccessToast'))
      navigate('/login')
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.passwordResetFailedGeneric'))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%', padding: '10px 14px',
    background: 'var(--input-bg)',
    border: `1.5px solid ${errors[field] ? 'var(--danger)' : 'var(--input-border)'}`,
    borderRadius: 10, fontSize: 14, color: 'var(--text)',
    outline: 'none', fontFamily: 'inherit',
  })

  const steps = [t('auth.stepEmail'), t('auth.stepCode'), t('auth.stepNewPassword')]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        style={{ width: '100%', maxWidth: 420, background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '36px 32px' }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Lockup height={48} style={{ margin: '0 auto' }} />
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
          {steps.map((s, i) => {
            const idx = ['email','otp','reset'].indexOf(step)
            const active = i === idx
            const done   = i < idx
            return (
              <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  {i > 0 && <div style={{ flex: 1, height: 2, background: done || active ? 'var(--brand)' : 'var(--border)' }} />}
                  <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, background: done ? 'var(--brand)' : active ? 'var(--btn-primary-bg)' : 'var(--border)', color: done || active ? 'var(--btn-primary-text)' : 'var(--text4)' }}>
                    {done ? <Check size={14} aria-label="done" /> : i + 1}
                  </div>
                  {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: done ? 'var(--brand)' : 'var(--border)' }} />}
                </div>
                <span style={{ fontSize: 10.5, color: active ? 'var(--link)' : 'var(--text4)', fontWeight: active ? 600 : 400 }}>{s}</span>
              </div>
            )
          })}
        </div>

        {/* SP-4-07: one persistent widget covering both 'email' and 'otp'
            steps (handleSendOTP backs both the initial send and "Resend
            code") — mounted once outside the per-step AnimatePresence so it
            never remounts between those two steps, just hidden on 'reset'. */}
        <div style={{ display: step === 'reset' ? 'none' : 'block', marginBottom: 16 }}>
          <Turnstile ref={turnstileRef} action="password_reset" onToken={setTurnstileToken} />
        </div>

        <AnimatePresence mode="wait">
          {step === 'email' && (
            <motion.div key="email" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t('auth.resetPasswordHeading')}</h2>
              <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>{t('auth.resetPasswordSubtext')}</p>
              <form onSubmit={handleSendOTP} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>{t('auth.email')}</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('auth.yourEmailPlaceholder')} style={inputStyle('email')} autoFocus />
                  {errors.email && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{errors.email}</div>}
                </div>
                <motion.button type="submit" disabled={loading || !turnstileToken} whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                  {loading ? t('auth.sendingCode') : t('auth.sendResetCodeArrow')}
                </motion.button>
              </form>
            </motion.div>
          )}

          {step === 'otp' && (
            <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t('auth.enterResetCodeHeading')}</h2>
              <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>
                {t('auth.weSentCodeTo')} <strong style={{ color: 'var(--text)' }}>{email}</strong>
              </p>
              <form onSubmit={handleVerifyOTP} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} autoFocus
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000"
                  style={{ width: '100%', padding: '14px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 12, fontSize: 32, fontWeight: 700, color: 'var(--text)', outline: 'none', textAlign: 'center', letterSpacing: 10, fontFamily: 'monospace' }} />
                {errors.otp && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{errors.otp}</div>}
                <motion.button type="submit" whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                  {t('auth.continueArrow')}
                </motion.button>
                <button type="button" disabled={!turnstileToken} onClick={() => handleSendOTP({ preventDefault: () => {} } as any)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, minHeight: 44, padding: '0 4px', color: 'var(--link)', fontWeight: 600 }}>
                  {t('auth.resendCode')}
                </button>
              </form>
            </motion.div>
          )}

          {step === 'reset' && (
            <motion.div key="reset" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t('auth.newPasswordHeading')}</h2>
              <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 24 }}>{t('auth.chooseStrongPassword')}</p>
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>{t('auth.newPasswordHeading')}</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('auth.minEightCharsPlaceholder')} style={inputStyle('password')} autoFocus autoComplete="new-password" />
                  {errors.password && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{errors.password}</div>}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>{t('auth.confirmPassword')}</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={t('auth.confirmPasswordPlaceholder')} style={inputStyle('confirm')} autoComplete="new-password" />
                  {errors.confirm && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{errors.confirm}</div>}
                </div>
                <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.97 }}
                  style={{ padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                  {loading ? t('auth.resettingEllipsis') : t('auth.resetPasswordArrow')}
                </motion.button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: 'var(--text3)' }}>
          <Link to="/login" style={{ color: 'var(--link)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44 }}><ArrowLeft size={16} aria-hidden />{t('auth.backToLogin')}</Link>
        </div>

        {/* SP-5-18: "from Vively" at the bottom, small and muted. */}
        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 10.5, color: 'var(--text4)' }}>
          {t('brand.attributionShort')}
        </div>
      </motion.div>
    </div>
  )
}
