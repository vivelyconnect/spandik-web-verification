// src/pages/legal/Grievance.tsx — SP-4-08/SP-15-13: IT Rules 2021 grievance
// mechanism. Deliberately public — reachable without logging in, since the
// Rules require the Grievance Officer to be reachable by any affected
// person, not just registered Spandik users.
import { useState, useRef } from 'react'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { grievanceApi, type GrievanceCategory } from '../../utils/api'
import Turnstile, { type TurnstileHandle } from '../../components/ui/Turnstile'
import toast from 'react-hot-toast'
import Footer from '../../components/layout/Footer'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border)',
  fontSize: 14, color: 'var(--text)', background: 'var(--white)', fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 6, display: 'block' }

// SP-15-13: mirrors api/src/config/grievance.ts's GRIEVANCE_CATEGORIES /
// URGENT_CATEGORIES — kept as a small literal list here rather than a
// shared package, since the frontend only needs labels + one urgency flag,
// not the SLA arithmetic itself (that stays server-side, computed from the
// authoritative env config).
const CATEGORY_OPTIONS: Array<{ value: GrievanceCategory; label: string; urgent: boolean }> = [
  { value: 'general_content', label: 'General content complaint', urgent: false },
  { value: 'account', label: 'Account issue', urgent: false },
  { value: 'child_safety', label: 'Child safety', urgent: true },
  { value: 'ncii', label: 'Non-consensual intimate imagery', urgent: true },
  { value: 'impersonation', label: 'Impersonation', urgent: true },
  { value: 'morphed_media', label: 'Morphed intimate imagery', urgent: true },
]

export default function Grievance() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [relatedLink, setRelatedLink] = useState('')
  const [category, setCategory] = useState<GrievanceCategory>('general_content')
  const [isLawEnforcement, setIsLawEnforcement] = useState(false)
  const [authorityReference, setAuthorityReference] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ id: string; category: GrievanceCategory; is_urgent: boolean; ack_due_at: string; resolve_due_at: string } | null>(null)
  const turnstileRef = useRef<TurnstileHandle>(null)

  const effectiveCategory: GrievanceCategory = isLawEnforcement ? 'law_enforcement' : category
  const selectedIsUrgent = isLawEnforcement || CATEGORY_OPTIONS.find(o => o.value === category)?.urgent === true

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !subject.trim() || details.trim().length < 10) {
      toast.error('Please fill in your name, email, subject, and a description (at least 10 characters).')
      return
    }
    if (isLawEnforcement && authorityReference.trim().length < 3) {
      toast.error('Please provide the authority name, badge/case number, or court order reference.')
      return
    }
    if (!turnstileToken) { toast.error('Please complete the verification widget'); return }
    setLoading(true)
    try {
      const res = await grievanceApi.submit({
        name: name.trim(), email: email.trim(), phone: phone.trim() || undefined,
        subject: subject.trim(), details: details.trim(), related_link: relatedLink.trim() || undefined,
        category: effectiveCategory,
        authority_reference: isLawEnforcement ? authorityReference.trim() : undefined,
        turnstile_token: turnstileToken,
      })
      setResult(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
      turnstileRef.current?.reset()
      setTurnstileToken('')
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 60px' }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--link)', fontWeight: 600, marginBottom: 20, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={16} aria-hidden />Back</button>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 900, color: 'var(--text)', marginBottom: 6 }}>Grievance Redressal</h1>
      <p style={{ fontSize: 13, color: 'var(--text4)', marginBottom: 32 }}>Under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021</p>

      <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 18, marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Grievance Officer</h2>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.8 }}>
          Name: Gita Sarkar<br />
          Designation: Director<br />
          Email: <a href="mailto:grievance@spandik.com" style={{ color: 'var(--link)' }}>grievance@spandik.com</a><br />
          Phone: +91-7812075858
        </p>
        <p style={{ fontSize: 12, color: 'var(--text4)', marginTop: 10 }}>
          Complaints are acknowledged within 24 hours and resolved within 15 days, as required under Rule 3(2) of the IT Rules 2021.
        </p>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text4)', marginBottom: 24 }}>
        Spandik is a product of Vively Technology Solutions Private Limited<br />
        CIN: U62099WR2026PTC292269<br />
        Registered office: LP-28/13/1/1, Ramkrishna Pally (W), Nimta, North 24 Parganas, West Bengal 700049, India
      </div>

      {result ? (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, textAlign: 'center' }}>
          <CircleCheck size={32} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--success)' }} />
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Complaint received</h2>
          <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: 14, marginBottom: 16, display: 'inline-block' }}>
            <div style={{ fontSize: 11, color: 'var(--text4)', marginBottom: 2 }}>Your reference number</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{result.id}</div>
          </div>
          {result.is_urgent && (
            <p style={{ fontSize: 13, color: 'var(--danger-strong)', fontWeight: 700, marginBottom: 12 }}>
              This has been routed as an urgent complaint and prioritized for faster review.
            </p>
          )}
          <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7 }}>
            We will acknowledge this complaint by {new Date(result.ack_due_at).toLocaleString()} and aim to resolve it by {new Date(result.resolve_due_at).toLocaleString()}.
            A confirmation with this reference number has been sent to your email — reply to it any time to add information or if you're not satisfied with our response.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Your name *</label>
            <input aria-label="Your name" style={inputStyle} value={name} onChange={e => setName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <label style={labelStyle}>Your email *</label>
            <input aria-label="Your email" style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label style={labelStyle}>Phone (optional)</label>
            <input aria-label="Phone" style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} maxLength={20} />
          </div>
          <div>
            <label style={labelStyle}>What is this about? *</label>
            <select aria-label="What is this about?" style={inputStyle} value={category} disabled={isLawEnforcement} onChange={e => setCategory(e.target.value as GrievanceCategory)}>
              {CATEGORY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}{o.urgent ? ' (urgent)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Subject *</label>
            <input aria-label="Subject" style={inputStyle} value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} placeholder="e.g. Content not removed after report, account access issue" />
          </div>
          <div>
            <label style={labelStyle}>Describe your complaint *</label>
            <textarea aria-label="Describe your complaint" style={{ ...inputStyle, minHeight: 140, resize: 'vertical' }} value={details} onChange={e => setDetails(e.target.value)} maxLength={4000} />
          </div>
          <div>
            <label style={labelStyle}>Link to the relevant post/profile/conversation (optional)</label>
            <input aria-label="Related link" style={inputStyle} value={relatedLink} onChange={e => setRelatedLink(e.target.value)} maxLength={500} />
          </div>

          <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>
              <input type="checkbox" checked={isLawEnforcement} onChange={e => setIsLawEnforcement(e.target.checked)} />
              I am a law enforcement official, or this relates to a court order
            </label>
            {isLawEnforcement && (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Authority name, badge/case number, or court order reference *</label>
                <input aria-label="Authority or court order reference" style={inputStyle} value={authorityReference} onChange={e => setAuthorityReference(e.target.value)} maxLength={300} />
              </div>
            )}
          </div>

          {selectedIsUrgent && (
            <p style={{ fontSize: 12.5, color: 'var(--danger-strong)' }}>
              This category is treated as urgent and reviewed on a faster timeline. If you or someone else is in immediate danger, please also contact local law enforcement (dial 112) without delay.
            </p>
          )}

          <Turnstile ref={turnstileRef} action="grievance_submit" onToken={setTurnstileToken} />

          <button type="submit" disabled={loading || !turnstileToken}
            style={{ padding: '13px', minHeight: 44, borderRadius: 12, border: 'none', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontWeight: 700, fontSize: 15, cursor: loading ? 'default' : 'pointer', opacity: loading || !turnstileToken ? 0.6 : 1 }}>
            {loading ? 'Submitting…' : 'Submit complaint'}
          </button>
        </form>
      )}
      <Footer />
    </div>
  )
}
