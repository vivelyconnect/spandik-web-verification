// src/pages/PostDetail.tsx
import { useState } from 'react'
import { ArrowLeft, MessageCircle, Reply, ThumbsUp } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'
import { useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { postApi } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import PostCard from '../components/post/PostCard'
import Avatar from '../components/ui/Avatar'
import MentionInput from '../components/ui/MentionInput'
import ReportModal from '../components/ui/ReportModal'
import LinkPreviewCard from '../components/post/LinkPreviewCard'
import { useLinkPreview } from '../hooks/useLinkPreview'
import toast from 'react-hot-toast'
import { useT } from '../i18n/useT'
import { apiAgeMs } from '../utils/time'

const REACTIONS = [
  { type: 'like', emoji: '👍' }, { type: 'love', emoji: '❤️' },
  { type: 'haha', emoji: '😂' }, { type: 'wow', emoji: '😮' },
  { type: 'sad', emoji: '😢' }, { type: 'angry', emoji: '😡' },
  { type: 'respect', emoji: '🙏' },
]

// SP-2-14: cap visual indentation so a deep reply chain doesn't run off the
// edge of the screen — the tree structure (parent_id chain) stays fully
// correct at any depth, only the indent stops growing past this.
const MAX_INDENT_DEPTH = 4
const INDENT_PX = 24

function timeAgo(d: string, t: ReturnType<typeof useT>) {
  const diff = apiAgeMs(d)
  if (Number.isNaN(diff)) return ''
  if (diff < 60000) return t('post.justNow')
  if (diff < 3600000) return t('post.minutesShort', { n: String(Math.floor(diff / 60000)) })
  if (diff < 86400000) return t('post.hoursShort', { n: String(Math.floor(diff / 3600000)) })
  return t('post.daysShort', { n: String(Math.floor(diff / 86400000)) })
}

// One bounded cursor page of comments — roots when `threadRootId` is
// omitted, or the flattened thread under that root otherwise. Shared by the
// top-level list and every expanded thread so "Load more" works the same
// way at any depth.
function useCommentPage(postId: string, threadRootId: string | undefined, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: threadRootId ? ['thread', threadRootId] : ['comments', postId],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      postApi.comments(postId, pageParam, threadRootId).then(r => r.data.data as { comments: any[]; next_cursor: string | null }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.next_cursor || undefined,
    enabled,
  })
}

export default function PostDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const user     = useAuthStore(s => s.user)
  const t        = useT()
  const { ref, inView } = useInView()

  const [comment, setComment] = useState('')
  // SP-11-06R: same shared hook the post composer uses (hooks/useLinkPreview.ts).
  const rootLinkPreview = useLinkPreview(comment)

  const { data: post, isLoading } = useQuery({
    queryKey: ['post', id],
    queryFn: () => postApi.get(id!).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: commentsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useCommentPage(id!, undefined, !!id)

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [inView, hasNextPage, isFetchingNextPage])

  const roots = commentsData?.pages.flatMap(p => p.comments) || []
  const totalRootCount = roots.length

  const commentMutation = useMutation({
    mutationFn: () => postApi.comment(id!, { content: comment, parent_id: null, link_preview_dismissed: rootLinkPreview.dismissed }),
    onSuccess: () => {
      setComment('')
      rootLinkPreview.reset()
      qc.invalidateQueries({ queryKey: ['comments', id] })
      qc.invalidateQueries({ queryKey: ['post', id] })
      qc.invalidateQueries({ queryKey: ['feed'] })
      toast.success(t('post.commentPosted'))
    },
    onError: () => toast.error(t('post.commentPostError')),
  })

  if (isLoading) return <PostDetailSkeleton />
  if (!post) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text4)' }}>{t('post.postNotFound')}</div>

  // SP-2-19: the effective create/reply permission is BOTH signals ANDed —
  // the post-level hard gate (comments_enabled) and the existing SP-11-03
  // account-level privacy gate (can_comment). Kept as two distinct booleans
  // (not collapsed into one) so the UI can show the right message for each;
  // the real 403 enforcement is server-side regardless of what's shown here.
  const commentsOff = post?.comments_enabled === false
  const commentsAllowed = !commentsOff && post?.can_comment !== false

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 100px' }}>
      <button onClick={() => navigate(-1)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--link)', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4, minHeight: 44 }}>
        <ArrowLeft size={18} aria-hidden />{t('onboarding.back')}
      </button>

      <PostCard post={post}
        onDelete={() => { navigate(-1) }}
        onUpdate={(_, u) => qc.setQueryData(['post', id], (old: any) => ({ ...old, ...u }))}
      />

      {/* Comments */}
      <div style={{ marginTop: 8, background: 'var(--white)', borderRadius: 'var(--r)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '16px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><MessageCircle size={18} aria-hidden />{t('post.commentsHeading')} {totalRootCount > 0 && `(${totalRootCount})`}</span>
        </div>

        {/* Comment input — always top-level; replies happen inline on each
            comment. SP-11-03 Section 48: if the owner's privacy setting
            disallows this viewer, the composer is disabled with a clear
            reason instead of failing only after a click — the create
            endpoint remains the real 403 enforcement regardless. */}
        {commentsOff ? (
          <div data-testid="comments-off-notice" style={{ background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: 'var(--text4)', textAlign: 'center' }}>
            {t('post.commentsOff')}
          </div>
        ) : post?.can_comment === false ? (
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: 'var(--text4)', textAlign: 'center' }}>
            {t('profile.commentsRestricted')}
          </div>
        ) : (
        <div data-testid="root-comment-composer" style={{ background: 'var(--bg2)', borderRadius: 12, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={32} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <MentionInput
                value={comment}
                onChange={setComment}
                placeholder={t('post.writeCommentPlaceholder')}
                rows={2}
                maxLength={1000}
                onSubmit={() => { if (comment.trim()) commentMutation.mutate() }}
              />
              {!rootLinkPreview.dismissed && (
                <LinkPreviewCard
                  preview={rootLinkPreview.preview}
                  loading={rootLinkPreview.loading}
                  onRemove={rootLinkPreview.dismiss}
                  compact
                />
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <motion.button whileTap={{ scale: 0.95 }}
              disabled={!comment.trim() || commentMutation.isPending}
              onClick={() => commentMutation.mutate()}
              style={{ padding: '7px 18px', minHeight: 44, borderRadius: 8, fontSize: 13, fontWeight: 700, background: comment.trim() ? 'var(--btn-primary-bg)' : 'var(--bg2)', color: comment.trim() ? 'var(--btn-primary-text)' : 'var(--text4)', border: 'none', cursor: comment.trim() ? 'pointer' : 'default' }}>
              {commentMutation.isPending ? t('post.postingEllipsis') : t('nav.post')}
            </motion.button>
          </div>
        </div>
        )}

        {/* Comments list */}
        {roots.map((c: any) => (
          <CommentItem key={c.id} comment={c} postId={id!} depth={0} commentsAllowed={commentsAllowed} />
        ))}

        {/* Load more roots */}
        {isFetchingNextPage && <CommentSkeleton />}
        <div ref={ref} style={{ height: 20 }} />

        {!roots.length && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text4)' }}>
            <MessageCircle size={32} strokeWidth={1.5} aria-hidden style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>{t('post.noCommentsYet')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function CommentItem({ comment, postId, depth, commentsAllowed }: { comment: any; postId: string; depth: number; commentsAllowed: boolean }) {
  const t = useT()
  const [showReactions, setShowReactions] = useState(false)
  const [reaction, setReaction] = useState<string | null>(null)
  const [showThread, setShowThread] = useState(false)
  const [showReplyBox, setShowReplyBox] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(comment.content || '')
  const [showReport, setShowReport] = useState(false)
  const longPress = { timer: 0 as any }
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const isOwn = user?.id === comment.user_id
  const isRoot = depth === 0

  // Fetches the flattened thread once, under the ROOT's own id — every
  // descendant at any depth comes back in one paginated list and gets
  // reassembled into a tree client-side via parent_id below. Nested nodes
  // never actually fetch (enabled=false); the key still uses this node's own
  // id rather than a shared/undefined key so a disabled nested query can
  // never collide with the top-level root list's ['comments', postId] cache
  // entry.
  const { data: threadData, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCommentPage(postId, comment.id, isRoot && showThread && comment.reply_count > 0)

  // SP-11-06R: live preview while editing, same shared hook as the
  // composer/reply box — idle (empty string) whenever not actively editing.
  const editLinkPreview = useLinkPreview(editing ? editText : '')

  const editMutation = useMutation({
    mutationFn: () => postApi.editComment(postId, comment.id, editText, { link_preview_dismissed: editLinkPreview.dismissed }),
    onSuccess: () => {
      setEditing(false)
      editLinkPreview.reset()
      qc.invalidateQueries({ queryKey: ['comments', postId] })
      qc.invalidateQueries({ queryKey: ['thread', comment.thread_root_id || comment.id] })
      toast.success(t('post.commentUpdated'))
    },
    onError: () => toast.error(t('post.commentUpdateError')),
  })

  async function handleDeleteComment() {
    if (!confirm(t('post.deleteCommentConfirm'))) return
    try {
      await postApi.deleteComment(postId, comment.id)
      qc.invalidateQueries({ queryKey: ['comments', postId] })
      qc.invalidateQueries({ queryKey: ['thread', comment.thread_root_id || comment.id] })
      qc.invalidateQueries({ queryKey: ['post', postId] })
      toast.success(t('post.commentDeleted'))
    } catch { toast.error(t('post.commentDeleteError')) }
  }

  function onPressStart() { longPress.timer = setTimeout(() => setShowReactions(true), 400) }
  function onPressEnd() {
    clearTimeout(longPress.timer)
    if (!showReactions) { setReaction('like') }
  }

  if (comment.is_tombstone) {
    return (
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, marginLeft: Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg2)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ background: 'var(--bg2)', borderRadius: '4px 14px 14px 14px', padding: '10px 12px', fontSize: 13, fontStyle: 'italic', color: 'var(--text4)' }}>
            {t('post.deletedPlaceholder')}
          </div>
          {comment.reply_count > 0 && (
            <ThreadedReplies comment={comment} postId={postId} depth={depth} commentsAllowed={commentsAllowed} />
          )}
        </div>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: 'flex', gap: 10, marginBottom: 14, position: 'relative', marginLeft: Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX }}>
      <Avatar src={comment.profile_pic_url} name={comment.first_name} size={depth === 0 ? 32 : 24} />
      <div style={{ flex: 1 }}>
        <div style={{ background: 'var(--bg2)', borderRadius: '4px 14px 14px 14px', padding: '10px 12px', position: 'relative' }}>
          <AnimatePresence>
            {showReactions && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 99, padding: '6px 10px', display: 'flex', gap: 4, boxShadow: 'var(--shadow-lg)', zIndex: 10, marginBottom: 4 }}>
                {REACTIONS.map((r, i) => (
                  <motion.button key={r.type} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.03 }}
                    whileHover={{ scale: 1.3, y: -3 }}
                    onClick={() => { setReaction(r.type); setShowReactions(false) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 2 }}>
                    {r.emoji}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{comment.first_name} {comment.last_name}</span>
            <span style={{ fontSize: 11, color: 'var(--text4)' }}>@{comment.username}</span>
          </div>

          {editing ? (
            <div>
              <MentionInput value={editText} onChange={setEditText} rows={2} maxLength={1000} autoFocus />
              {!editLinkPreview.dismissed && (
                <LinkPreviewCard
                  preview={editLinkPreview.preview}
                  loading={editLinkPreview.loading}
                  onRemove={editLinkPreview.dismiss}
                  compact
                />
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => { setEditing(false); setEditText(comment.content); editLinkPreview.reset() }}
                  style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, background: 'var(--white)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text3)' }}>{t('share.cancel')}</button>
                <button onClick={() => editMutation.mutate()} disabled={!editText.trim() || editMutation.isPending}
                  style={{ padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                  {editMutation.isPending ? '...' : t('post.save')}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
              {comment.content}
              {comment.is_edited && <span style={{ fontSize: 10.5, color: 'var(--text4)', marginLeft: 6 }}>{t('post.editedSuffix')}</span>}
            </div>
          )}
        </div>

        {/* SP-11-06R: server-generated snapshot, never re-fetched on render */}
        {!editing && comment.link_preview && (
          <LinkPreviewCard preview={comment.link_preview} compact />
        )}

        {!editing && (
          <div style={{ display: 'flex', gap: 12, marginTop: 5, paddingLeft: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text4)' }}>{timeAgo(comment.created_at, t)}</span>
            <button
              onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerLeave={() => clearTimeout(longPress.timer)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: reaction ? 'var(--link)' : 'var(--text4)', display: 'flex', alignItems: 'center', gap: 3, padding: '8px 6px', margin: '-8px -6px' }}>
              {reaction ? <span aria-hidden>{REACTIONS.find(r => r.type === reaction)?.emoji}</span> : <ThumbsUp size={13} aria-hidden />} {t('post.like')}
            </button>
            {commentsAllowed && (
              <button onClick={() => setShowReplyBox(!showReplyBox)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--link)', padding: '8px 6px', margin: '-8px -6px' }}>
                {t('post.reply')}
              </button>
            )}
            {isOwn && (
              <button onClick={() => setEditing(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text4)', padding: '8px 6px', margin: '-8px -6px' }}>
                {t('post.editAction')}
              </button>
            )}
            {isOwn && (
              <button onClick={handleDeleteComment}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--danger)', padding: '8px 6px', margin: '-8px -6px' }}>
                {t('chat.delete')}
              </button>
            )}
            {!isOwn && (
              <button onClick={() => setShowReport(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text4)', padding: '8px 6px', margin: '-8px -6px' }}>
                {t('post.report')}
              </button>
            )}
            {isRoot && comment.reply_count > 0 && (
              <button onClick={() => setShowThread(!showThread)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text4)' }}>
                {t(
                  showThread
                    ? (comment.reply_count === 1 ? 'post.hideReply' : 'post.hideReplies')
                    : (comment.reply_count === 1 ? 'post.viewReply' : 'post.viewReplies'),
                  { count: String(comment.reply_count) }
                )}
              </button>
            )}
          </div>
        )}

        {/* Inline reply box — targets THIS specific node, any depth */}
        {showReplyBox && (
          <InlineReplyBox
            postId={postId}
            parentId={comment.id}
            rootId={comment.thread_root_id || comment.id}
            parentUsername={comment.username}
            onSuccess={() => { setShowReplyBox(false); setShowThread(true) }}
            onCancel={() => setShowReplyBox(false)}
          />
        )}

        {/* Full nested tree for this root, reassembled from the flattened thread */}
        {isRoot && showThread && (
          <RootThread
            comment={comment} postId={postId} depth={depth}
            threadData={threadData} hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage} fetchNextPage={fetchNextPage}
            commentsAllowed={commentsAllowed}
          />
        )}
      </div>
      {showReport && <ReportModal targetType="comment" targetId={comment.id} onClose={() => setShowReport(false)} />}
    </motion.div>
  )
}

// Renders the whole tree under a root from its already-fetched flat
// descendant list, nesting each reply under its real parent_id (never
// assuming a fixed depth) plus a "Load more replies" control.
function RootThread({ comment, postId, depth, threadData, hasNextPage, isFetchingNextPage, fetchNextPage, commentsAllowed }: {
  comment: any; postId: string; depth: number
  threadData: any; hasNextPage: boolean | undefined; isFetchingNextPage: boolean; fetchNextPage: () => void
  commentsAllowed: boolean
}) {
  const t = useT()
  const flat = threadData?.pages.flatMap((p: any) => p.comments) || []
  const childrenByParent = new Map<string, any[]>()
  for (const node of flat) {
    const arr = childrenByParent.get(node.parent_id) || []
    arr.push(node)
    childrenByParent.set(node.parent_id, arr)
  }
  const directChildren = childrenByParent.get(comment.id) || []

  function renderNode(node: any, nodeDepth: number): React.ReactNode {
    return (
      <div key={node.id}>
        <CommentItem comment={node} postId={postId} depth={nodeDepth} commentsAllowed={commentsAllowed} />
        {(childrenByParent.get(node.id) || []).map(child => renderNode(child, nodeDepth + 1))}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      {directChildren.map(child => renderNode(child, depth + 1))}
      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
          style={{ marginLeft: (depth + 1) * INDENT_PX, marginTop: -8, marginBottom: -8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--link)', padding: '12px 0' }}>
          {isFetchingNextPage ? t('feed.loading') : t('post.loadMoreReplies')}
        </button>
      )}
    </div>
  )
}

// Tombstoned roots still show their live descendants — this fetches its own
// thread query the same way the normal expanded-root path does, since a
// tombstoned root can be shown without ever going through `showThread`.
function ThreadedReplies({ comment, postId, depth, commentsAllowed }: { comment: any; postId: string; depth: number; commentsAllowed: boolean }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useCommentPage(postId, comment.id, true)
  return (
    <RootThread comment={comment} postId={postId} depth={depth}
      threadData={data} hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} fetchNextPage={fetchNextPage}
      commentsAllowed={commentsAllowed} />
  )
}

function InlineReplyBox({ postId, parentId, rootId, parentUsername, onSuccess, onCancel }: {
  postId: string; parentId: string; rootId: string; parentUsername: string | null; onSuccess: () => void; onCancel: () => void
}) {
  const t = useT()
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  // SP-11-06R: same shared hook as the composer/root comment box.
  const replyLinkPreview = useLinkPreview(text)

  async function submit() {
    if (!text.trim()) return
    setPosting(true)
    try {
      await postApi.comment(postId, { content: text, parent_id: parentId, link_preview_dismissed: replyLinkPreview.dismissed })
      qc.invalidateQueries({ queryKey: ['thread', rootId] })
      qc.invalidateQueries({ queryKey: ['comments', postId] })
      qc.invalidateQueries({ queryKey: ['post', postId] })
      onSuccess()
    } catch {} finally { setPosting(false) }
  }

  return (
    <div data-testid="inline-reply-composer" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={24} />
      <div style={{ flex: 1 }}>
        {parentUsername && (
          <div style={{ fontSize: 11, color: 'var(--link)', marginBottom: 4, fontWeight: 600 }}>
            <Reply size={12} aria-hidden style={{ verticalAlign: '-2px' }} /> {t('post.replyingTo', { username: parentUsername })}
          </div>
        )}
        <MentionInput value={text} onChange={setText} rows={2} placeholder={parentUsername ? t('post.replyToPlaceholder', { username: parentUsername }) : t('post.writeReplyPlaceholder')} autoFocus />
        {!replyLinkPreview.dismissed && (
          <LinkPreviewCard
            preview={replyLinkPreview.preview}
            loading={replyLinkPreview.loading}
            onRemove={replyLinkPreview.dismiss}
            compact
          />
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 5, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text3)' }}>{t('share.cancel')}</button>
          <button onClick={submit} disabled={!text.trim() || posting}
            style={{ padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: text.trim() ? 'var(--btn-primary-bg)' : 'var(--bg2)', color: text.trim() ? 'var(--btn-primary-text)' : 'var(--text4)', border: 'none', cursor: 'pointer' }}>
            {posting ? '...' : t('post.reply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CommentSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
      <div className="skeleton-bone" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton-bone" style={{ height: 12, width: '30%', borderRadius: 6, marginBottom: 6 }} />
        <div className="skeleton-bone" style={{ height: 11, width: '80%', borderRadius: 6 }} />
      </div>
    </div>
  )
}

function PostDetailSkeleton() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 100px' }}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r)', border: '1px solid var(--border)', padding: 16, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div className="skeleton-bone" style={{ width: 38, height: 38, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-bone" style={{ height: 12, width: '35%', borderRadius: 6, marginBottom: 6 }} />
            <div className="skeleton-bone" style={{ height: 10, width: '20%', borderRadius: 6 }} />
          </div>
        </div>
        <div className="skeleton-bone" style={{ height: 14, width: '90%', borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-bone" style={{ height: 14, width: '60%', borderRadius: 6, marginBottom: 12 }} />
        <div className="skeleton-bone" style={{ height: 260, borderRadius: 12 }} />
      </div>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--r)', border: '1px solid var(--border)', padding: 16 }}>
        <div className="skeleton-bone" style={{ height: 15, width: '30%', borderRadius: 6, marginBottom: 14 }} />
        <CommentSkeleton />
        <CommentSkeleton />
      </div>
    </div>
  )
}
