// src/stores/celebrationStore.ts — SP-5-02, corrected under Bundle SP5-A
// independent-review remediation. First-post/first-friend delight moment.
//
// The original version keyed idempotency by a device-global flag
// (`spandik_celebrated_first_post`), which proved only "this browser has
// ever seen a successful post/accept since the flag existed" — not this
// ACCOUNT's actual first post/friend, and one account's milestone could
// suppress a different account's real one on a shared browser.
//
// Now: the local flag is keyed per account (never username — user id is
// the stable identity) and is duplicate-display suppression ONLY. The
// actual truth check is server-authoritative — `GET /users/me`'s
// `post_count`/`friend_count` (both already real, already-computed
// server fields; `friend_count` added in this remediation, no migration)
// — a milestone only visually fires when the authoritative count is
// exactly 1, i.e. this genuinely is the first. An established account
// with existing posts/friends but no local flag (new device, cleared
// storage, etc.) therefore never gets a fake "first" celebration.
//
// Decorative only: a truth-check failure (network error, etc.) never
// blocks or reports failure on the caller's already-succeeded post/accept
// action — it just silently skips the celebration for that occurrence.
import { create } from 'zustand'
import { userApi } from '../utils/api'

export type Milestone = 'first_post' | 'first_friend'

const KEY_PREFIX = 'spandik_celebrated_'

function localKey(userId: string, m: Milestone): string {
  return `${KEY_PREFIX}${userId}_${m}`
}

export function hasCelebratedLocally(userId: string, m: Milestone): boolean {
  try { return localStorage.getItem(localKey(userId, m)) === '1' } catch { return true }
}

export function markCelebratedLocally(userId: string, m: Milestone): void {
  try { localStorage.setItem(localKey(userId, m), '1') } catch {}
}

// Pure decision logic — the ONE authoritative rule for whether a count
// represents a genuine "first". Extracted so it's testable without a
// network call (this project's vitest setup has no jsdom — see e.g.
// motion/prefs.ts's decorativeMotionEnabled for the same convention).
export function isGenuineFirst(count: number | null | undefined): boolean {
  return count === 1
}

interface CelebrationState {
  active: Milestone | null
  celebrate: (userId: string, milestone: Milestone) => Promise<void>
  clear: () => void
}

export const useCelebrationStore = create<CelebrationState>((set) => ({
  active: null,
  celebrate: async (userId, milestone) => {
    if (!userId) return
    if (hasCelebratedLocally(userId, milestone)) return
    try {
      const res = await userApi.me()
      const count = milestone === 'first_post' ? res.data.data.post_count : res.data.data.friend_count
      // Mark celebrated either way once we have a real answer — a "not
      // actually first" account is permanently suppressed (it will never
      // become first again), and a genuine first is one-shot. Only a
      // thrown error (network/parse failure) below leaves the flag unset,
      // so a later genuinely-first check can still resolve correctly.
      markCelebratedLocally(userId, milestone)
      if (isGenuineFirst(count)) set({ active: milestone })
    } catch {
      // Decorative only — see file header. Never celebrate on an
      // unresolved truth check, never surface an error to the caller.
    }
  },
  clear: () => set({ active: null }),
}))
