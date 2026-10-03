// src/utils/profileCache.ts — SP-15-28
//
// One canonical, shape-aware React Query cache-sync helper — called once,
// synchronously, right after a fresh `GET /users/me` confirms a profile
// photo change was actually accepted server-side (never called with an
// optimistic/unconfirmed URL). Fixes the reported defect where the
// auth-store avatar updated immediately but the separate `['profile',
// username]` cache the own Profile header renders from only updated on
// the next async `invalidateQueries` refetch.
//
// Deliberately explicit per query shape rather than a generic recursive
// cache walker — each patcher knows the exact real shape of the query it
// targets (audited directly against the pages/components that own them)
// and never touches an unrelated field (content, counts, moderation,
// reactions, link previews, unrelated author identity). `setQueriesData`'s
// default (non-`exact`) key matching means `queryKey: ['post']` matches
// every individual `['post', id]` cache without needing to enumerate ids.
//
// Bounded scope (Section 26): patches only the surfaces a user directly,
// immediately sees without a reload — own profile, own posts (feed/
// explore/userPosts/savedPosts/single post), own comments/replies. Every
// other cache that could contain the current user's avatar (suggestions,
// friend requests, follow lists, notifications, chat threads, search/
// mention results) is handled by ordinary background `invalidateQueries`
// in the caller, not a synchronous patch — deliberately not a generic
// normalized-cache rewrite.
import type { QueryClient } from '@tanstack/react-query'

export interface FreshProfileUser {
  id: string
  username: string
  profile_pic_url: string | null
  [key: string]: unknown
}

function isFreshUser(u: unknown): u is FreshProfileUser {
  return !!u && typeof u === 'object' && typeof (u as any).id === 'string'
}

// ── Post-shaped patchers (post.author.{id,profile_pic_url}) ──────────────
function patchPostAuthor(post: any, freshUser: FreshProfileUser): any {
  if (!post || typeof post !== 'object' || !post.author || post.author.id !== freshUser.id) return post
  if (post.author.profile_pic_url === freshUser.profile_pic_url) return post
  return { ...post, author: { ...post.author, profile_pic_url: freshUser.profile_pic_url } }
}

function patchPostArray(posts: any, freshUser: FreshProfileUser): any {
  if (!Array.isArray(posts)) return posts
  return posts.map(p => patchPostAuthor(p, freshUser))
}

// `['feed']` shape: useInfiniteQuery, { pages: [{ posts: Post[], next_cursor }] }.
// Cursors/next_cursor are copied through untouched — only post.author is ever replaced.
function patchInfinitePostPages(data: any, freshUser: FreshProfileUser): any {
  if (!data || !Array.isArray(data.pages)) return data
  return {
    ...data,
    pages: data.pages.map((page: any) =>
      page && Array.isArray(page.posts) ? { ...page, posts: patchPostArray(page.posts, freshUser) } : page
    ),
  }
}

// ── Comment-shaped patchers (comment.user_id + top-level profile_pic_url) ─
function patchCommentAuthor(comment: any, freshUser: FreshProfileUser): any {
  if (!comment || typeof comment !== 'object' || comment.user_id !== freshUser.id) return comment
  if (comment.profile_pic_url === freshUser.profile_pic_url) return comment
  return { ...comment, profile_pic_url: freshUser.profile_pic_url }
}

// `['comments', postId]` / `['thread', rootId]` shape: useInfiniteQuery,
// { pages: [{ comments: Comment[], next_cursor }] }. Tree structure
// (parent_id/thread_root_id/reply_count) and content are never touched.
function patchInfiniteCommentPages(data: any, freshUser: FreshProfileUser): any {
  if (!data || !Array.isArray(data.pages)) return data
  return {
    ...data,
    pages: data.pages.map((page: any) =>
      page && Array.isArray(page.comments) ? { ...page, comments: page.comments.map((c: any) => patchCommentAuthor(c, freshUser)) } : page
    ),
  }
}

/**
 * Synchronously patches every currently-cached surface where the current
 * user's own avatar is directly, immediately visible, using the real
 * shape of each query. Safe to call with a missing/empty cache (no-op,
 * never throws) or with unexpected/partial cached data (patchers fall
 * through and return the value unchanged rather than corrupting it).
 */
export function syncOwnProfileImageCaches(qc: QueryClient, freshUser: unknown): void {
  if (!isFreshUser(freshUser)) return

  // Own profile header — the exact surface of the reported defect.
  qc.setQueriesData({ queryKey: ['profile', freshUser.username] }, (old: any) =>
    old && typeof old === 'object' ? { ...old, profile_pic_url: freshUser.profile_pic_url } : old
  )

  // Own posts grid (plain array, already server-filtered to this username).
  qc.setQueriesData({ queryKey: ['userPosts', freshUser.username] }, (old: any) => patchPostArray(old, freshUser))

  // Feed (infinite pages) / Explore / Saved (plain arrays).
  qc.setQueriesData({ queryKey: ['feed'] }, (old: any) => patchInfinitePostPages(old, freshUser))
  qc.setQueriesData({ queryKey: ['explore'] }, (old: any) => patchPostArray(old, freshUser))
  qc.setQueriesData({ queryKey: ['savedPosts'] }, (old: any) => patchPostArray(old, freshUser))

  // Single post view + comments/replies on any currently-open post/thread.
  // NOTE: `['thread', id]` is also used by ChatRoom.tsx for a DM thread's
  // metadata (`{ other_user, ... }`, a plain non-infinite query, no
  // `.pages`) — patchInfiniteCommentPages's own `Array.isArray(data.pages)`
  // guard already makes this a safe no-op for that cache; verified by a
  // dedicated test in profileCache.test.ts rather than assumed.
  qc.setQueriesData({ queryKey: ['post'] }, (old: any) => patchPostAuthor(old, freshUser))
  qc.setQueriesData({ queryKey: ['comments'] }, (old: any) => patchInfiniteCommentPages(old, freshUser))
  qc.setQueriesData({ queryKey: ['thread'] }, (old: any) => patchInfiniteCommentPages(old, freshUser))
}

// Background reconciliation for the remaining caches that CAN legitimately
// contain the current user's avatar but aren't in the immediate-visibility
// priority list (Section 26) — an ordinary async refetch is sufficient
// here, not a synchronous patch.
export function invalidateOtherOwnAvatarCaches(qc: QueryClient): void {
  for (const key of [['suggestions'], ['friend-requests'], ['follow-list'], ['notifications'], ['chat-threads'], ['stories'], ['hashtag'], ['search'], ['user-search'], ['mention-users'], ['onboarding-suggestions']]) {
    qc.invalidateQueries({ queryKey: key })
  }
}
