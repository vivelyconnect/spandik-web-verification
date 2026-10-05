// src/utils/callLifecycle.ts — pure call-screen rules (UAT: a ~45 s call ended
// as "Call ended 0:00" with a stale "Calling…" still on screen).
export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended' | 'failed'

// The "Calling… / Connecting… / outcome" overlay belongs only to the phases
// before a connection and to a failed attempt (declined / no answer / cancel —
// a missed call stays distinct from a call that connected and then ended).
export function showsPreConnectOverlay(state: CallState): boolean {
  return state === 'calling' || state === 'ringing' || state === 'failed'
}

// Whole seconds actually connected: from the first connect to hang-up (or to
// now while live). null = never connected, so no duration is shown.
export function connectedSeconds(connectedAt: number | null, endedAt: number | null, now: number): number | null {
  if (connectedAt === null) return null
  return Math.max(0, Math.floor(((endedAt ?? now) - connectedAt) / 1000))
}

export function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}
