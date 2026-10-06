// src/utils/postCache.ts — SP-2-17: after a SUCCESSFUL visibility change, make
// every currently-cached copy of that post agree with the server's answer, so
// no surface keeps showing the old visibility until a hard reload. Shape-aware
// like profileCache.ts (each patcher knows its query's real shape and touches
// ONLY `visibility` on the matching post id — never content, counts, controls,
// reactions, media or moderation state). Server-filtered public lists
// (explore / hashtag / feed) are then invalidated so they refetch truthfully.
import type { QueryClient } from '@tanstack/react-query'
import type { PostVisibility } from './postVisibility'

function patchPost(post: any, id: string, visibility: PostVisibility): any {
  if (!post || typeof post !== 'object' || post.id !== id || post.visibility === visibility) return post
  return { ...post, visibility }
}
function patchArray(posts: any, id: string, visibility: PostVisibility): any {
  return Array.isArray(posts) ? posts.map(p => patchPost(p, id, visibility)) : posts
}
// useInfiniteQuery { pages: [{ posts: Post[], next_cursor }] } — cursors untouched.
function patchPages(data: any, id: string, visibility: PostVisibility): any {
  if (!data || !Array.isArray(data.pages)) return data
  return { ...data, pages: data.pages.map((pg: any) => pg && Array.isArray(pg.posts) ? { ...pg, posts: patchArray(pg.posts, id, visibility) } : pg) }
}

export function syncPostVisibilityCaches(qc: QueryClient, postId: string, visibility: PostVisibility): void {
  qc.setQueriesData({ queryKey: ['post', postId] }, (old: any) => patchPost(old, postId, visibility))
  qc.setQueriesData({ queryKey: ['feed'] }, (old: any) => patchPages(old, postId, visibility))
  for (const key of ['userPosts', 'savedPosts', 'explore', 'hashtag'] as const) {
    qc.setQueriesData({ queryKey: [key] }, (old: any) => patchArray(old, postId, visibility))
  }
  // Lists the server filters by visibility: refetch rather than guess membership.
  for (const key of ['feed', 'explore', 'hashtag', 'userPosts'] as const) qc.invalidateQueries({ queryKey: [key] })
}
