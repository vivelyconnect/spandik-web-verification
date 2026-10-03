// src/utils/ringtone.ts — SP-3-05: an original, generated ringtone (Web
// Audio oscillators) — deliberately NOT a bundled audio asset copied or
// derived from WhatsApp/FaceTime/Messenger/etc (IP risk the task explicitly
// calls out). A simple two-tone alternating pattern, the generic shape of a
// classic phone ring, built entirely from oscillator nodes at runtime.
//
// Browser autoplay policy: an AudioContext created/resumed with no prior
// user gesture on the page stays 'suspended' — `startRingtone()` reports
// this via its return value's `blocked` flag rather than throwing, so the
// call UI can still render correctly and show a "tap to enable sound" hint
// (see IncomingCallOverlay.tsx) instead of silently failing. A conservative
// vibration pattern (where supported) is a supplement, never the only
// alert, per the task's own requirement.

const RING_ON_MS = 1200
const RING_OFF_MS = 3000
const VIBRATE_PATTERN = [400, 200, 400, 2200] // ms: on, off, on, pause — loosely mirrors the tone cadence

export interface RingtoneHandle {
  blocked: boolean
  /** Retry starting audio after a user gesture (e.g. any tap on the overlay). */
  retryAfterGesture: () => void
  stop: () => void
}

export function startRingtone(): RingtoneHandle {
  let stopped = false
  let ctx: AudioContext | null = null
  let cycleTimer: ReturnType<typeof setTimeout> | undefined
  let blocked = false

  const AudioCtor = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!AudioCtor) {
    // No Web Audio support at all — the call UI itself still works, this
    // is purely the audio layer degrading gracefully (section 16's "if
    // audio playback is blocked, the call UI must still visibly work").
    return { blocked: true, retryAfterGesture: () => {}, stop: () => {} }
  }
  ctx = new AudioCtor()

  function playOneRing() {
    if (stopped || !ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05)
      gain.gain.setValueAtTime(0.2, now + RING_ON_MS / 1000 - 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + RING_ON_MS / 1000)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(now + i * 0.001)
      osc.stop(now + RING_ON_MS / 1000 + 0.02)
    })
  }

  function scheduleLoop() {
    if (stopped) return
    playOneRing()
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(VIBRATE_PATTERN) } catch { /* unsupported/blocked — audio/visual remain */ }
    }
    cycleTimer = setTimeout(scheduleLoop, RING_ON_MS + RING_OFF_MS)
  }

  function begin() {
    ctx!.resume().then(() => {
      if (stopped) return
      if (ctx!.state === 'running') { blocked = false; scheduleLoop() }
      else blocked = true
    }).catch(() => { blocked = true })
  }
  begin()
  // Report the synchronous best-known state; a caller checking `blocked`
  // immediately after construction may see a stale `false` while the
  // resume() promise above is still settling — the overlay itself doesn't
  // depend on catching that first tick perfectly, only on retryAfterGesture
  // being available for the common real case (a genuinely suspended context).
  blocked = ctx.state !== 'running'

  return {
    get blocked() { return blocked },
    retryAfterGesture: () => { if (!stopped) begin() },
    stop: () => {
      stopped = true
      clearTimeout(cycleTimer)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(0) } catch { /* no-op */ }
      }
      ctx?.close().catch(() => {})
    },
  } as RingtoneHandle
}
