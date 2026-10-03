// src/components/call/IncomingCallOverlay.tsx — SP-3-05: the full-screen
// incoming-call experience, mounted once from AppShell.tsx so it renders
// regardless of which page the callee is currently on (Home, Explore,
// Chats, Settings, ...) — it is fed entirely by the ONE existing global
// presence WebSocket (see hooks/incomingCall.ts's defensive parsers +
// stores/callStore.ts), never a second socket.
//
// UI Law 2 (radical simplicity): full-screen, unmistakable, one primary
// action pair, ≥44px targets, icon+text on every control, no gesture-only
// action, safe-area aware.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useCallStore } from '../../stores/callStore'
import { callApi } from '../../utils/api'
import { startRingtone, type RingtoneHandle } from '../../utils/ringtone'
import { msUntilExpiry } from '../../hooks/incomingCall'
import Avatar from '../ui/Avatar'
import { Phone, PhoneOff, Video } from 'lucide-react'
import { useT } from '../../i18n/useT'

export default function IncomingCallOverlay() {
  const incoming = useCallStore(s => s.incoming)
  const setIncoming = useCallStore(s => s.setIncoming)
  const navigate = useNavigate()
  const t = useT()

  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(30)
  const ringtoneRef = useRef<RingtoneHandle | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!incoming) {
      ringtoneRef.current?.stop()
      ringtoneRef.current = null
      clearInterval(tickRef.current)
      setBusy(null)
      return
    }

    // Guard against a duplicate/retried incoming_call push for the SAME
    // call_id (e.g. a redelivered internal push) ever starting a second
    // ringtone/timer on top of an already-ringing overlay.
    if (ringtoneRef.current) return

    const handle = startRingtone()
    ringtoneRef.current = handle
    setAudioBlocked(handle.blocked)

    // Visual countdown ONLY — the server's Durable Object alarm is the sole
    // authority for the actual 30s missed-call boundary (section 17). If
    // this timer reaches zero before the server's own call_resolved(missed)
    // push arrives, the UI simply keeps waiting at 0 rather than fabricating
    // a missed state itself.
    setSecondsLeft(Math.max(0, Math.round(msUntilExpiry(incoming.expires_at) / 1000)))
    tickRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1))
    }, 1000)

    return () => {
      handle.stop()
      ringtoneRef.current = null
      clearInterval(tickRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.call_id])

  if (!incoming) return null

  function retryAudio() {
    ringtoneRef.current?.retryAfterGesture()
    setAudioBlocked(false)
  }

  async function handleAccept() {
    if (busy) return
    setBusy('accept')
    try {
      const res = await callApi.accept(incoming!.call_id)
      const callId = incoming!.call_id
      setIncoming(null)
      navigate(`/connect?callId=${encodeURIComponent(callId)}`, {
        state: { ticket: res.data.data.ticket, roomCode: res.data.data.room_code },
      })
    } catch {
      // Deterministic safe result: the call was resolved elsewhere (expired,
      // cancelled, accepted on another device) before this device's accept
      // landed — just dismiss, exactly as if a call_resolved push had.
      setIncoming(null)
    } finally {
      setBusy(null)
    }
  }

  async function handleDecline() {
    if (busy) return
    setBusy('decline')
    try { await callApi.decline(incoming!.call_id) } catch { /* best effort — dismiss regardless */ }
    setIncoming(null)
    setBusy(null)
  }

  const callerName = incoming.caller.first_name || incoming.caller.username
  const label = incoming.mode === 'audio' ? t('call.incomingAudioCall') : t('call.incomingVideoCall')

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={audioBlocked ? retryAudio : undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'linear-gradient(180deg, #1a1030 0%, #0a0a0a 100%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 'calc(48px + env(safe-area-inset-top))',
          paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: 600 }}>{label}</div>
          {audioBlocked && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>{t('call.tapToEnableSound')}</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            <Avatar src={incoming.caller.profile_pic_url} name={callerName} size={120} />
          </motion.div>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, textAlign: 'center' }}>{callerName}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>@{incoming.caller.username}</div>
          {/* Visual countdown only — see this file's header comment; the
              server's own Durable Object alarm is the sole authority for
              when a call actually becomes missed. */}
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }} aria-hidden="true">{secondsLeft}s</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 56, width: '100%' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleDecline() }}
            disabled={busy !== null}
            aria-label={t('call.decline')}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer', minWidth: 44,
            }}
          >
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--danger-fill)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              boxShadow: '0 4px 20px var(--danger-border)',
            }}>
              <PhoneOff size={28} aria-hidden />
            </div>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('call.decline')}</span>
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); handleAccept() }}
            disabled={busy !== null}
            aria-label={t('call.accept')}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer', minWidth: 44,
            }}
          >
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'var(--success)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              boxShadow: '0 4px 20px var(--success)',
            }}>
              {incoming.mode === 'audio' ? <Phone size={28} aria-hidden /> : <Video size={28} aria-hidden />}
            </div>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('call.accept')}</span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
