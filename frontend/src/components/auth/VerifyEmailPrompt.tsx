// src/components/auth/VerifyEmailPrompt.tsx — SP-15-05
//
// Register.tsx's "Verify later" (skipVerify) leaves an account with no
// other reachable way to complete verification — before this task that was
// low-stakes (only posting/events/new-DMs were gated), but this task blocks
// many more actions for an unverified account, so a real, permanent path
// back to verification is now required, not optional polish. Same
// resend/verify flow as Register.tsx's inline version, extracted so
// Settings and any gated-action placeholder (e.g. EventNew.tsx) can embed
// it instead of a dead-end message.
import { useState, useRef } from 'react'
import { Mail } from 'lucide-react'
import { authApi, refreshAccessToken } from '../../utils/api'
import { useAuthStore } from '../../stores/authStore'
import Turnstile, { type TurnstileHandle } from '../../components/ui/Turnstile'
import toast from 'react-hot-toast'
import { useT } from '../../i18n/useT'

export default function VerifyEmailPrompt({ message }: { message?: string }) {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const [otpCode, setOtpCode] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sent, setSent] = useState(false)
  const turnstileRef = useRef<TurnstileHandle>(null)

  if (!user || user.email_verified) return null

  async function handleResend() {
    if (!turnstileToken) { toast.error(t('auth.completeVerificationWidget')); return }
    setSending(true)
    try {
      await authApi.resendVerify(user!.email, turnstileToken)
      setSent(true)
      toast.success(t('verify.codeSentToast'))
    } catch {
      toast.error(t('verify.sendCodeFailedGeneric'))
    } finally {
      setSending(false)
      turnstileRef.current?.reset()
      setTurnstileToken('')
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!otpCode || otpCode.length !== 6) { toast.error(t('auth.enterSixDigitCode')); return }
    setVerifying(true)
    try {
      await authApi.verifyEmail({ email: user!.email, code: otpCode })
      // SP-15-05: the in-memory access token still carries email_verified:
      // false in its claims until refreshed — same reasoning as
      // Register.tsx's handleVerify. The store's user is already populated
      // here (unlike mid-registration), and the refresh cookie SP-15-19
      // introduced is already set, so the shared single-flight
      // refreshAccessToken() helper is the right, DRY choice.
      await refreshAccessToken().catch(() => {})
      setUser({ email_verified: true })
      toast.success(t('verify.emailVerifiedToast'))
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('auth.verifyFailedGeneric'))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div style={{ background: 'var(--card-bg, #fff)', border: '1.5px solid var(--input-border)', borderRadius: 14, padding: 20, textAlign: 'center', maxWidth: 380, margin: '0 auto' }}>
      <Mail size={32} strokeWidth={1.5} aria-hidden style={{ marginBottom: 8, color: 'var(--link)' }} />
      <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
        {message || t('verify.defaultMessage')}
      </p>

      {!sent ? (
        <>
          <div style={{ transform: 'scale(0.85)', transformOrigin: 'center', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <Turnstile ref={turnstileRef} action="verify_prompt_resend" onToken={setTurnstileToken} />
          </div>
          <button type="button" onClick={handleResend} disabled={sending || !turnstileToken}
            style={{ width: '100%', padding: '10px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
            {sending ? t('auth.sendingCode') : t('verify.sendCodeToButton', { email: user.email })}
          </button>
        </>
      ) : (
        <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="text" inputMode="numeric" maxLength={6} value={otpCode} autoFocus
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            style={{ width: '100%', padding: '12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 24, fontWeight: 700, color: 'var(--text)', outline: 'none', textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace' }} />
          <button type="submit" disabled={verifying}
            style={{ width: '100%', padding: '10px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
            {verifying ? t('auth.verifying') : t('verify.verifyEmailButton')}
          </button>
          <button type="button" onClick={() => setSent(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--text4)', minHeight: 32 }}>
            {t('verify.sendNewCode')}
          </button>
        </form>
      )}
    </div>
  )
}
