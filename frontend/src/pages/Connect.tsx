// src/pages/Connect.tsx — LiveConnect video call UI
import { type CallState, showsPreConnectOverlay, connectedSeconds, formatDuration } from '../utils/callLifecycle'
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { m as motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, PhoneOff, ScreenShare, Video as VideoIcon, VideoOff } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { api, callApi } from '../utils/api'
import { useCallStore } from '../stores/callStore'
import { useT } from '../i18n/useT'

const LC_WS_URL     = import.meta.env.VITE_LC_WS_URL || 'wss://lc.spandik.com'

// SP-15-20: TURN credentials are minted server-side, per call, short-lived —
// never a static secret baked into the client bundle (VITE_* values are
// inlined at build time and readable by anyone; a static coturn credential
// lived here before this fix). Falls back to STUN-only if the mint call
// fails for an infra reason (Rule 8b: fail open for availability, not
// safety) — a blocked-user rejection (403) is NOT an infra failure and is
// re-thrown so the caller sees it, not silently downgraded.
async function fetchIceServers(targetUserId?: string | null): Promise<RTCIceServer[]> {
  try {
    const res = await api.post('/liveconnect/turn-credentials', { target_user_id: targetUserId || undefined })
    return res.data.data.iceServers
  } catch (err: any) {
    if (err?.response?.status === 403) throw new Error('BLOCKED')
    console.error('TURN credential fetch failed, falling back to STUN-only', err)
    return [{ urls: 'stun:stun.cloudflare.com:3478' }]
  }
}

// SP-3-05: `ringing` used to mean "a peer joined the signaling room" — that
// conflated two different things once a real invitation model existed
// (whether the CALLEE has even been alerted yet vs. whether WebRTC has a
// peer). `calling` now covers the whole "waiting for the callee to answer"
// window (both signaling-room-empty and server-side ringing), and the
// caller's outcome text is driven by the server's own call_resolved event
// (see `outcome` state below), never guessed from peer/socket state alone.
type CallOutcome = 'declined' | 'no_answer' | 'cancelled' | 'failed' | null

export default function Connect() {
  const navigate      = useNavigate()
  const location      = useLocation()
  const [params]      = useSearchParams()
  const accessToken   = useAuthStore(s => s.accessToken)
  const t             = useT()
  const resolvedEvent = useCallStore(s => s.resolved)

  const targetUserId  = params.get('user')
  const targetName    = params.get('username')
  // SP-3-05: a targeted call the CALLEE is joining after tapping Accept in
  // IncomingCallOverlay.tsx — its call_id doubles as the LiveConnect
  // room_code (see api/src/utils/callId()'s header comment). The join
  // ticket, when available, arrives via router state (never the URL/browser
  // history) — see IncomingCallOverlay's navigate() call.
  const joinCallId    = params.get('callId')
  const navState      = location.state as { ticket?: string; roomCode?: string } | null

  // SP-0-16c: room code is no longer generated client-side (was
  // Math.random(), not even cryptographically random) — it comes back from
  // the ticket endpoint, server-generated with a real CSPRNG, if not
  // already supplied via ?room= (joining an existing untargeted call) or a
  // targeted call's own id.
  const roomCodeRef   = useRef(params.get('room') || joinCallId || null as string | null)
  // The active targeted call id, if any (set when this tab either starts or
  // is joining one) — used to match incoming call_resolved pushes so a
  // push for a DIFFERENT call (e.g. a stale tab) is never acted on.
  const activeCallIdRef = useRef<string | null>(joinCallId)

  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const wsRef          = useRef<WebSocket | null>(null)
  const pcRef          = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const [callState, setCallState] = useState<CallState>('idle')
  const [outcome, setOutcome]     = useState<CallOutcome>(null)
  // Mirrors activeCallIdRef for rendering only (e.g. the Cancel button
  // below) — updating a ref alone never triggers a re-render, so the ref
  // stays the single source of truth read by the resolvedEvent effect and
  // async handlers, while this state exists purely so the UI reflects it.
  const [outgoingCallId, setOutgoingCallId] = useState<string | null>(null)
  const [peers, setPeers]         = useState<any[]>([])
  const [muted, setMuted]         = useState(false)
  const [videoOff, setVideoOff]   = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  // Real connected time (UAT): stamped on the first connect, frozen at hang-up.
  const [connectedAt, setConnectedAt]     = useState<number | null>(null)
  const [endedAt, setEndedAt]             = useState<number | null>(null)
  const [, setTick]                       = useState(0)
  const durationRef = useRef<ReturnType<typeof setInterval>>()

  // Auto-start: either place an outgoing targeted call (?user=, from
  // ChatRoom's Call button), or join one already accepted (?callId=, from
  // IncomingCallOverlay's Accept button).
  useEffect(() => {
    if (joinCallId && accessToken) {
      joinAcceptedCall(joinCallId, navState?.ticket, navState?.roomCode || joinCallId)
    } else if (targetUserId && accessToken) {
      startTargetedCall()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Caller side: react to the server's own authoritative resolution of the
  // outgoing call this tab placed — never inferred from a client-side
  // timer or from WebRTC/signaling state alone (section 17/22 of the task).
  useEffect(() => {
    if (!resolvedEvent || !activeCallIdRef.current || resolvedEvent.call_id !== activeCallIdRef.current) return
    if (callState === 'connected' || callState === 'ended') return // already joined — a late/duplicate push is a no-op
    switch (resolvedEvent.outcome) {
      case 'accepted':
        // Only the CALLER reaches this branch — the callee already knows
        // it accepted (it's the one that called the API) and joins via
        // joinAcceptedCall directly, not this effect.
        if (targetUserId) void joinAsCaller(activeCallIdRef.current)
        break
      case 'declined':
        setOutcome('declined'); setCallState('failed')
        break
      case 'missed':
        setOutcome('no_answer'); setCallState('failed')
        break
      case 'cancelled':
        setOutcome('cancelled'); setCallState('failed')
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedEvent])

  // Call duration: stamp the first connect, re-render once a second while live.
  useEffect(() => {
    if (callState === 'connected') {
      setConnectedAt(at => at ?? Date.now())
      durationRef.current = setInterval(() => setTick(n => n + 1), 1000)
    } else {
      clearInterval(durationRef.current)
      if (callState === 'idle') { setConnectedAt(null); setEndedAt(null) }
    }
    return () => clearInterval(durationRef.current)
  }, [callState])
  const callDuration = connectedSeconds(connectedAt, endedAt, Date.now())

  // ── SP-3-05: start a targeted 1:1 call (server-authoritative) ──
  async function startTargetedCall() {
    if (!targetUserId) return
    try {
      setCallState('calling')
      setOutcome(null)
      const res = await callApi.start(targetUserId)
      activeCallIdRef.current = res.data.data.call_id
      setOutgoingCallId(res.data.data.call_id)
      roomCodeRef.current = res.data.data.room_code
    } catch (err: any) {
      if (err?.response?.status === 403) setOutcome('failed')
      else if (err?.response?.status === 404) setOutcome('failed')
      setCallState('failed')
    }
  }

  async function cancelOutgoingCall() {
    if (activeCallIdRef.current) {
      try { await callApi.cancel(activeCallIdRef.current) } catch { /* best effort — server timeout is the backstop */ }
    }
    setCallState('idle')
    navigate(-1)
  }

  // Caller learned (via the server's call_resolved push) that the callee
  // accepted — mint this tab's OWN fresh join ticket (the accept response
  // already minted one for the callee; this is the caller's turn) and join
  // the same room.
  async function joinAsCaller(callId: string) {
    try {
      const res = await callApi.joinTicket(callId)
      await connectToRoom(res.data.data.room_code, res.data.data.ticket, targetUserId)
    } catch {
      setOutcome('failed')
      setCallState('failed')
    }
  }

  // Callee side: already has (or can re-mint) a join ticket for an
  // already-accepted call — connect straight into the room, no "calling"
  // wait state at all.
  async function joinAcceptedCall(callId: string, ticket?: string, roomCode?: string) {
    activeCallIdRef.current = callId
    try {
      let finalTicket = ticket
      let finalRoom = roomCode || callId
      if (!finalTicket) {
        // Reload/new-tab fallback — the ticket only ever travels via
        // router state (never the URL), so a hard refresh loses it; a
        // fresh one can always be re-minted for an actual participant of
        // an already-accepted call (see routes/calls.ts's join-ticket).
        const res = await callApi.joinTicket(callId)
        finalTicket = res.data.data.ticket
        finalRoom = res.data.data.room_code
      }
      await connectToRoom(finalRoom, finalTicket, null)
    } catch {
      setOutcome('failed')
      setCallState('failed')
    }
  }

  // Shared by both the untargeted "Start a call" idle-page flow and the
  // targeted caller/callee join paths above — everything from here down is
  // unchanged existing WebRTC/signaling behavior (SP-0-16c/SP-15-20).
  async function connectToRoom(roomCode: string, ticket: string, targetForTurn: string | null) {
    setCallState('calling')
    const iceServers = await fetchIceServers(targetForTurn)

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStreamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream

    // SP-2-11: ticket only, no raw access token in the URL.
    const ws = new WebSocket(`${LC_WS_URL}/signal/${roomCode}?ticket=${ticket}`)
    wsRef.current = ws

    ws.onopen = () => setupPeerConnection(stream, ws, iceServers)
    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      await handleSignal(msg, stream)
    }
    ws.onclose = () => { if (callState !== 'ended') endCall() }
  }

  // ── Untargeted/generic call (manual "Start a call" from the idle page,
  // or joining via a shared ?room= link) — unchanged behavior, no server
  // call-session model involved (see routes/liveconnect.ts's own header
  // comment on why this stays a separate, simpler path). ──
  async function startCall() {
    try {
      setCallState('calling')
      const ticketRes = await api.post('/liveconnect/ticket', { room_code: roomCodeRef.current || undefined })
      const { room_code, ticket } = ticketRes.data.data
      roomCodeRef.current = room_code
      await connectToRoom(room_code, ticket, targetUserId)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        alert(t('call.micRequiredAlert'))
      } else if (err.message === 'BLOCKED') {
        alert(t('call.cannotCallUserAlert'))
      }
      setCallState('failed')
    }
  }

  function setupPeerConnection(stream: MediaStream, ws: WebSocket, iceServers: RTCIceServer[]) {
    const pc = new RTCPeerConnection({ iceServers })
    pcRef.current = pc

    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0]
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }))
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setCallState('connected')
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) endCall()
    }

    return pc
  }

  async function handleSignal(msg: any, stream: MediaStream) {
    const pc = pcRef.current
    if (!pc) return

    switch (msg.type) {
      case 'joined':
        setPeers(msg.peers || [])
        // If we're the initiator and there are other peers, create offer
        if (msg.peers?.length > 0) {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }))
        }
        break

      case 'peer_joined':
        setPeers(prev => [...prev.filter(p => p.user_id !== msg.user_id), { user_id: msg.user_id, username: msg.username }])
        setCallState('ringing')
        break

      case 'offer':
        if (!pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }))
          setCallState('connected')
        }
        break

      case 'answer':
        if (!pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          setCallState('connected')
        }
        break

      case 'candidate':
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch {}
        break

      case 'peer_left':
        setPeers(prev => prev.filter(p => p.user_id !== msg.user_id))
        if (peers.length <= 1) endCall()
        break

      case 'call_failed':
        setCallState('failed')
        break
    }
  }

  function endCall() {
    wsRef.current?.send(JSON.stringify({ type: 'leave' }))
    wsRef.current?.close()
    pcRef.current?.close()
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    setEndedAt(at => at ?? Date.now())
    setCallState('ended')
    setScreenSharing(false)
  }

  function toggleMute() {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getAudioTracks().forEach(t => { t.enabled = muted })
    setMuted(!muted)
    wsRef.current?.send(JSON.stringify({ type: 'audio_state', muted: !muted }))
  }

  function toggleVideo() {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach(t => { t.enabled = videoOff })
    setVideoOff(!videoOff)
    wsRef.current?.send(JSON.stringify({ type: 'video_state', enabled: videoOff }))
  }

  async function toggleScreenShare() {
    if (screenSharing) {
      // Switch back to camera
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const videoTrack = stream.getVideoTracks()[0]
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
      if (sender) sender.replaceTrack(videoTrack)
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      setScreenSharing(false)
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]
        const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack)
        if (localVideoRef.current) localVideoRef.current.srcObject = screenStream
        screenTrack.onended = () => toggleScreenShare()
        setScreenSharing(true)
        wsRef.current?.send(JSON.stringify({ type: 'screen_share', sharing: true }))
      } catch {}
    }
  }


  function failedStateText(): string {
    switch (outcome) {
      case 'declined': return t('call.declinedState')
      case 'no_answer': return t('call.noAnswerState')
      case 'cancelled': return t('call.cancelledState')
      default: return t('call.failedState')
    }
  }

  // Idle state — landing (untargeted manual entry only; a targeted call
  // auto-starts above and never renders this).
  if (callState === 'idle') {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <VideoIcon size={64} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--link)' }} />
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>LiveConnect</h1>
        <p style={{ fontSize: 15, color: 'var(--text3)', marginBottom: 32, lineHeight: 1.6 }}>
          {t('call.taglineLine1')}<br />{t('call.taglineLine2')}
        </p>
        <motion.button whileTap={{ scale: 0.96 }} onClick={startCall}
          style={{ padding: '14px 36px', borderRadius: 99, fontSize: 16, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
          {t('call.startCallButton')}
        </motion.button>
        {targetName && (
          <div style={{ marginTop: 16, fontSize: 14, color: 'var(--text4)' }}>
            {t('call.callingPrefix')} <strong style={{ color: 'var(--text)' }}>@{targetName}</strong>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      {/* Remote video — full screen */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: callState === 'connected' ? 'block' : 'none' }} />

        {/* Calling/connecting overlay */}
        {showsPreConnectOverlay(callState) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
              style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
              <VideoIcon size={36} aria-hidden color="#fff" />
            </motion.div>
            <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>
              {callState === 'failed'
                ? failedStateText()
                : targetName ? `${t('call.calling')} @${targetName}` : callState === 'ringing' ? t('call.connectingEllipsis') : t('call.waitingEllipsis')}
            </div>
            {callState === 'failed' && (
              <button onClick={() => { setCallState('idle'); navigate(-1) }}
                style={{ padding: '10px 24px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 14, minHeight: 44 }}>
                {t('pin.goBack')}
              </button>
            )}
            {callState === 'calling' && targetUserId && outgoingCallId && (
              <button onClick={cancelOutgoingCall} aria-label={t('call.cancelCall')}
                style={{ padding: '10px 24px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 14, minHeight: 44 }}>
                {t('call.cancelCall')}
              </button>
            )}
          </div>
        )}

        {/* Duration */}
        {callState === 'connected' && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 12px', borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
            {formatDuration(callDuration ?? 0)}
          </div>
        )}

        {/* Local video — picture in picture */}
        <div style={{ position: 'absolute', bottom: 100, right: 16, width: 100, height: 140, borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.3)', background: '#111' }}>
          <video ref={localVideoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: videoOff ? 'none' : 'block' }} />
          {videoOff && (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)' }}><VideoOff size={28} aria-hidden /></div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)', display: 'flex', justifyContent: 'center', gap: 16, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <CallButton icon={muted ? <MicOff size={22} aria-hidden /> : <Mic size={22} aria-hidden />} label={muted ? t('call.unmuteLabel') : t('call.muteLabel')} active={muted} onClick={toggleMute} />
        <CallButton icon={videoOff ? <VideoOff size={22} aria-hidden /> : <VideoIcon size={22} aria-hidden />} label={videoOff ? t('call.startVideoLabel') : t('call.stopVideoLabel')} active={videoOff} onClick={toggleVideo} />
        <CallButton icon={<ScreenShare size={22} aria-hidden />} label={t('call.shareScreenLabel')} active={screenSharing} onClick={toggleScreenShare} />
        <motion.button whileTap={{ scale: 0.9 }} onClick={endCall}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--danger-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 4px 20px var(--danger-border)' }}>
            <PhoneOff size={24} aria-hidden color="#fff" />
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('call.endCallLabel')}</span>
        </motion.button>
      </div>

      {/* Ended overlay */}
      <AnimatePresence>
        {callState === 'ended' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <PhoneOff size={48} strokeWidth={1.5} aria-hidden color="rgba(255,255,255,0.8)" />
            <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{t('call.callEndedHeading')}</div>
            {callDuration !== null && <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>{formatDuration(callDuration)}</div>}
            <button onClick={() => navigate(-1)}
              style={{ marginTop: 8, padding: '12px 28px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
              {t('overlay.close')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CallButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)', color: active ? '#171329' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, transition: 'background 0.2s' }}>
        {icon}
      </div>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{label}</span>
    </motion.button>
  )
}
