// src/hooks/incomingCall.ts — SP-3-05: pure, framework-free logic for
// handling call-control events received over the global presence WebSocket
// (presenceConnection.ts's onServerEvent) — same reasoning/split as
// liveNotifications.ts (React-Query/DOM-free so it's directly unit-testable;
// the real React/store/ringtone wiring happens in AppShell.tsx +
// components/call/IncomingCallOverlay.tsx and is proven via real-browser
// E2E). Deliberately a SEPARATE envelope family from liveNotifications.ts's
// `{type:'notification'}` — call control is not a durable notification-list
// item and must never be confused with one.

const MAX_ID_LEN = 64
const MAX_NAME_LEN = 100
const MAX_URL_LEN = 500

function isBoundedString(v: unknown, maxLen: number, allowEmpty = false): v is string {
  return typeof v === 'string' && (allowEmpty || v.length > 0) && v.length <= maxLen
}

export interface IncomingCallCaller {
  id: string
  username: string
  first_name?: string | null
  profile_pic_url?: string | null
}

export interface IncomingCallEvent {
  event: 'incoming_call'
  call_id: string
  caller: IncomingCallCaller
  expires_at: string
  mode: 'video' | 'audio'
}

export type CallResolvedOutcome = 'accepted' | 'declined' | 'cancelled' | 'missed'

export interface CallResolvedEvent {
  event: 'call_resolved'
  call_id: string
  outcome: CallResolvedOutcome
  resolved_by: string | null
}

function isValidCaller(a: unknown): a is IncomingCallCaller {
  if (!a || typeof a !== 'object') return false
  const actor = a as any
  if (!isBoundedString(actor.id, MAX_ID_LEN)) return false
  if (!isBoundedString(actor.username, MAX_NAME_LEN)) return false
  if (actor.first_name !== undefined && actor.first_name !== null && !isBoundedString(actor.first_name, MAX_NAME_LEN, true)) return false
  if (actor.profile_pic_url !== undefined && actor.profile_pic_url !== null && !isBoundedString(actor.profile_pic_url, MAX_URL_LEN, true)) return false
  return true
}

// Defensive parse of a raw server WS frame — malformed, oversized, or
// wrong-shaped input is ignored (returns null), never thrown, never
// partially trusted, matching liveNotifications.ts's own bar.
export function parseIncomingCallEvent(raw: unknown): IncomingCallEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as any
  if (p.event !== 'incoming_call') return null
  if (!isBoundedString(p.call_id, MAX_ID_LEN)) return null
  if (!isValidCaller(p.caller)) return null
  if (!isBoundedString(p.expires_at, MAX_NAME_LEN)) return null
  if (p.mode !== 'video' && p.mode !== 'audio') return null
  return { event: 'incoming_call', call_id: p.call_id, caller: p.caller, expires_at: p.expires_at, mode: p.mode }
}

export function parseCallResolvedEvent(raw: unknown): CallResolvedEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as any
  if (p.event !== 'call_resolved') return null
  if (!isBoundedString(p.call_id, MAX_ID_LEN)) return null
  if (!['accepted', 'declined', 'cancelled', 'missed'].includes(p.outcome)) return null
  if (p.resolved_by !== null && !isBoundedString(p.resolved_by, MAX_ID_LEN)) return null
  return { event: 'call_resolved', call_id: p.call_id, outcome: p.outcome, resolved_by: p.resolved_by }
}

// Ringing UI countdown only — NEVER the authority for a missed call (the
// server's Durable Object alarm is). Used purely to drive the visual timer;
// its expiry must never itself post an accept/decline/cancel or fabricate a
// missed state — the overlay just waits for the server's own call_resolved
// push (or dismisses gracefully if that push is late/lost, since the call
// is over either way once the server-side deadline passes).
export function msUntilExpiry(expiresAtIso: string, now = Date.now()): number {
  const expiry = Date.parse(expiresAtIso)
  if (Number.isNaN(expiry)) return 0
  return Math.max(0, expiry - now)
}
