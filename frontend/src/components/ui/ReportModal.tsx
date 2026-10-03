// src/components/ui/ReportModal.tsx — SP-4-02: shared report sheet for
// posts, comments, users, and chat messages. Same bottom-sheet pattern as
// ShareSheet.tsx.
import { useState } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { reportApi, type ReportTargetType } from '../../utils/api'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n/useT'

// Remediation (2026-08-04, SP-15-17 closeout): must stay byte-identical to
// api/src/config/reportEvidence.ts's CURRENT_EVIDENCE_CONSENT_VERSION — the
// API now rejects any message-evidence report whose consent_version doesn't
// match exactly. Bumping this is a deliberate, reviewed change made only
// when the consent wording immediately below materially changes.
const CONSENT_VERSION = 'message-report-evidence-v1'

// Labels are i18n keys (looked up with t() at render) rather than literal
// English, since this array lives outside the component.
const REASONS: Array<{ value: string; labelKey: 'report.reasonSpam' | 'report.reasonNudity' | 'report.reasonViolence' | 'report.reasonHate' | 'report.reasonHarassment' | 'report.reasonOther' }> = [
  { value: 'spam', labelKey: 'report.reasonSpam' },
  { value: 'nudity', labelKey: 'report.reasonNudity' },
  { value: 'violence', labelKey: 'report.reasonViolence' },
  { value: 'hate', labelKey: 'report.reasonHate' },
  { value: 'harassment', labelKey: 'report.reasonHarassment' },
  { value: 'other', labelKey: 'report.reasonOther' },
]

interface ReportModalProps {
  targetType: ReportTargetType
  targetId: string
  // Only for target_type === 'message' — the reporter's OWN client-decrypted
  // text, exactly as shown on their screen. Never sent without the explicit
  // consent checkbox below being checked first.
  evidenceText?: string
  // SP-15-17: same idea for an image message — the reporter's own
  // client-decrypted image, base64-encoded, plus its mime type. Also never
  // sent without the same consent checkbox.
  evidenceMedia?: { base64: string; mime: string }
  onClose: () => void
}

export default function ReportModal({ targetType, targetId, evidenceText, evidenceMedia, onClose }: ReportModalProps) {
  const t = useT()
  const [reason, setReason] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const [consented, setConsented] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const locale = useAuthStore(s => s.user?.preferred_lang)

  const needsConsent = targetType === 'message' && (!!evidenceText || !!evidenceMedia)
  const canSubmit = !!reason && (!needsConsent || consented) && !submitting

  async function handleSubmit() {
    if (!canSubmit || !reason) return
    setSubmitting(true)
    try {
      const res = await reportApi.submit({
        target_type: targetType,
        target_id: targetId,
        reason,
        details: details.trim() || undefined,
        evidence_text: needsConsent ? evidenceText : undefined,
        evidence_media: needsConsent ? evidenceMedia?.base64 : undefined,
        evidence_media_mime: needsConsent ? evidenceMedia?.mime : undefined,
        // Remediation (2026-08-04): the API now independently enforces and
        // persists this — the checkbox below is the user-facing gate, not
        // the only proof consent happened.
        evidence_consent: needsConsent ? consented : undefined,
        consent_version: needsConsent ? CONSENT_VERSION : undefined,
        locale: needsConsent ? locale : undefined,
      })
      toast.success(res.data?.message || t('report.submittedToast'))
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('report.submitFailedGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 500, background: 'var(--white)', borderRadius: '20px 20px 0 0', padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', maxHeight: '85vh', overflowY: 'auto' }}>

          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{t('report.title')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text4)', marginBottom: 16 }}>{t('report.subtitle')}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
            {REASONS.map(r => (
              <button key={r.value} onClick={() => setReason(r.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 10, background: reason === r.value ? 'var(--bg2)' : 'transparent', border: '1px solid ' + (reason === r.value ? 'var(--brand)' : 'transparent'), cursor: 'pointer', fontSize: 14, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${reason === r.value ? 'var(--brand)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {reason === r.value && <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--brand)' }} />}
                </span>
                {t(r.labelKey)}
              </button>
            ))}
          </div>

          <textarea value={details} onChange={e => setDetails(e.target.value)} maxLength={500} rows={2}
            placeholder={t('report.detailsPlaceholder')}
            style={{ width: '100%', padding: '10px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 13.5, color: 'var(--text)', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, marginBottom: needsConsent ? 12 : 16 }} />

          {needsConsent && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px', background: 'var(--bg2)', borderRadius: 10, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                {evidenceMedia
                  ? t('report.consentPhotoText')
                  : t('report.consentMessageText')}
              </span>
            </label>
          )}

          <button onClick={handleSubmit} disabled={!canSubmit}
            style={{ width: '100%', padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, background: canSubmit ? 'var(--btn-primary-bg)' : 'var(--bg2)', color: canSubmit ? 'var(--btn-primary-text)' : 'var(--text4)', border: 'none', cursor: canSubmit ? 'pointer' : 'default', marginBottom: 8 }}>
            {submitting ? t('report.submittingEllipsis') : t('report.submitButton')}
          </button>
          <button onClick={onClose}
            style={{ width: '100%', padding: '12px', borderRadius: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text4)' }}>
            {t('chat.cancel')}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
