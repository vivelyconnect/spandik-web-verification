// src/utils/feedCache.ts — SP-5-09: offline "last feed" read cache.
// Privacy rules: only posts that are PUBLIC and moderation-APPROVED are
// ever stored (no friends-only/private posts, no pending/rejected
// content), keyed to the signed-in user's id, capped, and wiped on logout.
// Media is not stored here — images still come from the network/CDN.
const PREFIX = 'spandik_last_feed_'
export const MAX_CACHED_POSTS = 20

export function cacheablePosts(posts: any[]): any[] {
  return (posts || [])
    .filter(p => p && (p.visibility || 'public') === 'public' && p.moderation_status === 'approved' && !p.is_story)
    .slice(0, MAX_CACHED_POSTS)
}

export function saveLastFeed(userId: string, posts: any[], storage: Storage = localStorage) {
  if (!userId) return
  try { storage.setItem(PREFIX + userId, JSON.stringify({ savedAt: Date.now(), posts: cacheablePosts(posts) })) } catch {}
}

export function loadLastFeed(userId: string, storage: Storage = localStorage): { savedAt: number; posts: any[] } | null {
  if (!userId) return null
  try {
    const raw = storage.getItem(PREFIX + userId)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Logout / account switch: remove EVERY account's cached feed on this browser.
export function clearAllLastFeeds(storage: Storage = localStorage) {
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX)) keys.push(k) }
    keys.forEach(k => storage.removeItem(k))
  } catch {}
}
