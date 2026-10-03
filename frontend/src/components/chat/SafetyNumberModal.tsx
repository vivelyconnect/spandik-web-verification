// src/components/chat/SafetyNumberModal.tsx — SP-14-03: verify a contact's
// chat key out of band. Shows the 60-digit safety number (utils/safetyNumber)
// and its QR; scans the other phone's QR with the camera (native
// BarcodeDetector, jsQR fallback loaded only when scanning) or lets the user
// mark it verified after comparing the digits in person / on a call.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useT } from '../../i18n/useT'
import { safetyNumber, groupsOf5, qrPayload, digitsFromQr, markVerified, clearVerified, isVerified } from '../../utils/safetyNumber'

interface Props {
  me: { id: string; key: string }
  contact: { id: string; key: string; name: string }
  onClose: () => void
  onChange: () => void
}

export default function SafetyNumberModal({ me, contact, onClose, onChange }: Props) {
  const t = useT()
  const digits = useMemo(() => safetyNumber(me.id, me.key, contact.id, contact.key), [me.id, me.key, contact.id, contact.key])
  const qrSrc = useMemo(() => {
    const qr = qrcode(0, 'M'); qr.addData(qrPayload(digits)); qr.make()
    return qr.createDataURL(5, 2)
  }, [digits])
  const [verified, setVerified] = useState(() => isVerified(me.id, contact.id, contact.key))
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  function setState(next: boolean) {
    if (next) markVerified(me.id, contact.id, contact.key); else clearVerified(me.id, contact.id)
    setVerified(next); onChange()
  }

  function onScanned(text: string) {
    setScanning(false)
    if (digitsFromQr(text) === digits) { setState(true); setMessage({ ok: true, text: t('chat.verifySuccess') }) }
    else setMessage({ ok: false, text: t('chat.verifyMismatch') })
  }

  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | null = null, stop = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const video = videoRef.current!
        video.srcObject = stream; await video.play()
        const Detector = (window as any).BarcodeDetector
        const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
        const jsQR = detector ? null : (await import('jsqr')).default
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })!
        while (!stop) {
          if (video.videoWidth) {
            let text: string | undefined
            if (detector) text = (await detector.detect(video))[0]?.rawValue
            else {
              canvas.width = video.videoWidth; canvas.height = video.videoHeight
              ctx.drawImage(video, 0, 0)
              text = jsQR!(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data
            }
            if (text) { onScanned(text); return }
          }
          await new Promise(r => setTimeout(r, 200))
        }
      } catch {
        setScanning(false); setMessage({ ok: false, text: t('chat.verifyCameraError') })
      }
    })()
    return () => { stop = true; stream?.getTracks().forEach(tr => tr.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  const btn = { width: '100%', minHeight: 44, padding: '10px', borderRadius: 12, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer' } as const

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sn-title" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '24px 22px', maxWidth: 400, width: '100%', maxHeight: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', position: 'relative' }}>
        <button onClick={onClose} aria-label={t('overlay.close')}
          style={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)' }}>
          <X size={18} aria-hidden />
        </button>
        <h2 id="sn-title" style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t('chat.verifyTitle')}</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6, textAlign: 'center' }}>{t('chat.verifyBody', { name: contact.name })}</p>

        <div data-testid="safety-number" aria-label={digits.replace(/(\d{5})/g, '$1 ')}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '6px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 16, color: 'var(--text)', letterSpacing: 1 }}>
          {groupsOf5(digits).map((g, i) => <span key={i}>{g}</span>)}
        </div>

        {scanning
          ? <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000' }} />
          : <img src={qrSrc} alt={t('chat.verifyQrAlt')} style={{ width: 180, height: 180, imageRendering: 'pixelated' }} />}

        {message && <div role="status" style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</div>}

        {verified ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontWeight: 700, fontSize: 14 }}>
              <ShieldCheck size={18} aria-hidden /> {t('chat.verifyVerified')}
            </div>
            <button onClick={() => { setState(false); setMessage(null) }} style={{ ...btn, background: 'var(--bg2)', color: 'var(--text2)' }}>{t('chat.verifyClear')}</button>
          </>
        ) : (
          <>
            <button onClick={() => { setMessage(null); setScanning(s => !s) }} style={{ ...btn, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
              {scanning ? t('chat.verifyStopScan') : t('chat.verifyScan')}
            </button>
            <button onClick={() => { setState(true); setMessage({ ok: true, text: t('chat.verifySuccess') }) }} style={{ ...btn, background: 'var(--bg2)', color: 'var(--text2)' }}>
              {t('chat.verifyMarkMatch')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
