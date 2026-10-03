// src/hooks/liveNotifications.ts — SP-3-02: pure, framework-free logic for
// handling a live-pushed notification event received over the global
// presence WebSocket (presenceConnection.ts's onServerEvent). Kept
// React-Query- and DOM-free, same reasoning as presenceConnection.ts's own
// header comment (no jsdom/testing-library in this project's vitest setup)
// — this is what makes it directly unit-testable; the real React/toast/
// cache wiring happens in AppShell.tsx and is proven via real-browser E2E.

const MAX_ID_LEN = 64
const MAX_TEXT_LEN = 500

function isBoundedString(v: unknown, maxLen: number, allowEmpty = false): v is string {
  return typeof v === 'string' && (allowEmpty || v.length > 0) && v.length <= maxLen
}

export interface LiveNotificationActor {
  id: string
  username: string
  first_name?: string | null
  last_name?: string | null
  profile_pic_url?: string | null
  is_verified_badge?: boolean
}

export interface LiveNotification {
  id: string
  type: string
  message: string
  link: string
  entity_type: string
  entity_id: string
  actor: LiveNotificationActor | null
  is_read: boolean
  created_at: string
}

// Defensive parse of a raw server WS frame — malformed, oversized or
// wrong-shaped input is ignored (returns null), never thrown, never
// partially trusted. Matches the canonical envelope chat-worker's
// UserPresence DO pushes: {type:'notification', notification:{...}}.
export function parseLiveNotificationEvent(raw: unknown): LiveNotification | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as any
  if (p.type !== 'notification') return null
  const n = p.notification
  if (!n || typeof n !== 'object') return null
  if (!isBoundedString(n.id, MAX_ID_LEN)) return null
  if (!isBoundedString(n.type, MAX_ID_LEN)) return null
  if (!isBoundedString(n.message, MAX_TEXT_LEN)) return null
  if (!isBoundedString(n.link, MAX_TEXT_LEN, true)) return null
  if (!isBoundedString(n.entity_type, MAX_ID_LEN, true)) return null
  if (!isBoundedString(n.entity_id, MAX_ID_LEN, true)) return null
  if (typeof n.is_read !== 'boolean') return null
  if (!isBoundedString(n.created_at, MAX_TEXT_LEN)) return null

  let actor: LiveNotificationActor | null = null
  if (n.actor !== null) {
    if (!n.actor || typeof n.actor !== 'object') return null
    if (typeof n.actor.id !== 'string' || typeof n.actor.username !== 'string') return null
    actor = n.actor
  }

  return {
    id: n.id, type: n.type, message: n.message, link: n.link,
    entity_type: n.entity_type, entity_id: n.entity_id, actor,
    is_read: n.is_read, created_at: n.created_at,
  }
}

// Bounded FIFO id-dedup set — never grows past `capacity` (oldest id
// evicted first). A tab that stays open for hours, or a queue retry that
// lands much later, must never be able to grow this without bound.
export class BoundedIdSet {
  private ids: string[] = []
  private ids_set = new Set<string>()

  constructor(private capacity: number) {}

  /** Records `id` if unseen. Returns true iff this call newly recorded it. */
  addIfNew(id: string): boolean {
    if (this.ids_set.has(id)) return false
    this.ids.push(id)
    this.ids_set.add(id)
    if (this.ids.length > this.capacity) {
      const evicted = this.ids.shift()
      if (evicted !== undefined) this.ids_set.delete(evicted)
    }
    return true
  }

  has(id: string): boolean {
    return this.ids_set.has(id)
  }
}

// ── React Query cache shapes ──────────────────────────────────

// ['notif-badge'] (AppShell.tsx) holds the raw axios response envelope:
// { success, data: { unread_count, ... }, message? }
export interface NotifBadgeCache {
  data?: { unread_count?: number; [k: string]: unknown }
  [k: string]: unknown
}

// Returning the same `prev` reference (including `undefined`) tells
// react-query's setQueryData to leave the cache untouched — no query ever
// gets fabricated here, and an absent/malformed cache is a safe no-op.
export function bumpNotifBadgeCache(prev: NotifBadgeCache | undefined): NotifBadgeCache | undefined {
  if (!prev || !prev.data) return prev
  return { ...prev, data: { ...prev.data, unread_count: (prev.data.unread_count || 0) + 1 } }
}

// ['notifications'] (Buzz.tsx) holds the already-unwrapped body:
// { notifications: [...], unread_count }
export interface NotificationsListCache {
  notifications: Array<{ id: string; [k: string]: unknown }>
  unread_count: number
  [k: string]: unknown
}

export function prependToNotificationsCache(
  prev: NotificationsListCache | undefined, notification: LiveNotification
): NotificationsListCache | undefined {
  if (!prev) return prev // no loaded list cache — leave it absent, don't fabricate one
  if (prev.notifications.some(n => n.id === notification.id)) return prev // already present — no-op
  return {
    ...prev,
    notifications: [{ ...notification }, ...prev.notifications],
    unread_count: (prev.unread_count || 0) + 1,
  }
}
