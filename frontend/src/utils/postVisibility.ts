// src/utils/postVisibility.ts — SP-2-17: the post-visibility vocabulary the
// owner control shares with the composer. One list, one set of values
// ('public' | 'friends' | 'private' — what POST/PATCH /posts already accept);
// the labels are the composer's own i18n keys (Public / Friends / Only me).
import type { StringKey } from '../i18n/strings'

export type PostVisibility = 'public' | 'friends' | 'private'
export const POST_VISIBILITIES: readonly PostVisibility[] = ['public', 'friends', 'private']

// Missing / unknown (older cached payloads) read as public, same default as the API.
export function normalizeVisibility(v: unknown): PostVisibility {
  return v === 'friends' || v === 'private' ? v : 'public'
}

const REACH: Record<PostVisibility, number> = { public: 2, friends: 1, private: 0 }

export type VisibilityChange = 'same' | 'narrow' | 'widen'
export function visibilityChange(from: PostVisibility, to: PostVisibility): VisibilityChange {
  if (from === to) return 'same'
  return REACH[to] < REACH[from] ? 'narrow' : 'widen'
}

export const VISIBILITY_LABEL_KEY: Record<PostVisibility, StringKey> = {
  public: 'composer.visibilityPublic',
  friends: 'nav.friends',
  private: 'settings.privacyOnlyMe',
}
export const VISIBILITY_DESC_KEY: Record<PostVisibility, StringKey> = {
  public: 'post.visibilityPublicDesc',
  friends: 'post.visibilityFriendsDesc',
  private: 'post.visibilityPrivateDesc',
}

// What choosing `to` means, in plain words: who stops seeing it / who starts.
export function visibilityNoteKey(from: PostVisibility, to: PostVisibility): StringKey | null {
  if (from === to) return null
  if (to === 'private') return 'post.visibilityNoteToPrivate'
  if (to === 'friends') return from === 'public' ? 'post.visibilityNoteToFriendsNarrow' : 'post.visibilityNoteToFriendsWiden'
  return 'post.visibilityNoteToPublic'
}
