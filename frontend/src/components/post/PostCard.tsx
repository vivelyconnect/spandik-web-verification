// src/components/post/PostCard.tsx — Enterprise PostCard with Phase 4 features
import { lazy, Suspense, useState, useRef } from 'react'
import { m as motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { postApi } from '../../utils/api'
import { useAuthStore } from '../../stores/authStore'
import Avatar from '../ui/Avatar'
import VerifiedBadge from '../ui/VerifiedBadge'
const ImageViewer = lazy(() => import('../ui/ImageViewer'))
import VideoPlayer from '../ui/VideoPlayer'
const ShareSheet = lazy(() => import('../ui/ShareSheet'))
const ReportModal = lazy(() => import('../ui/ReportModal'))
import LinkPreviewCard from './LinkPreviewCard'
import toast from 'react-hot-toast'
import { useT } from '../../i18n/useT'
import { useDataSaverStore } from '../../stores/dataSaverStore'
import { buildDelivery } from '../../utils/mediaDelivery'
import { PRESS_TAP, burstPieces, burstTransition } from '../../motion/presets'
import { hapticTap } from '../../motion/haptics'
import Overlay from '../ui/Overlay'
import { Bookmark, Ellipsis, Flag, Link as LinkIcon, MapPin, MessageCircle, Pencil, Share2, ThumbsUp, Trash2 } from 'lucide-react'

const REACTIONS = [
  { type: 'like', emoji: '👍' }, { type: 'love', emoji: '❤️' },
  { type: 'haha', emoji: '😂' }, { type: 'wow', emoji: '😮' },
  { type: 'sad', emoji: '😢' }, { type: 'angry', emoji: '😡' },
  { type: 'respect', emoji: '🙏' },
]

function reactionEmoji(type: string | null): string {
  return REACTIONS.find(r => r.type === type)?.emoji || '👍'
}

export default function PostCard({ post, onUpdate, onDelete }: { post: any; onUpdate?: (id: string, u: any) => void; onDelete?: (id: string) => void }) {
  const t = useT()
  const user     = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const dataSaver = useDataSaverStore(s => s.enabled)

  const [showPicker, setShowPicker]     = useState(false)
  const [reaction, setReaction]         = useState<string | null>(post.viewer_reaction)
  const [reactionCount, setCount]       = useState(post.reaction_count || 0)
  const [saved, setSaved]               = useState(post.is_saved)
  const [likeAnim, setLikeAnim]         = useState(false)
  const [hearts, setHearts]             = useState<ReturnType<typeof burstPieces>>([])
  const [imageViewer, setImageViewer]   = useState<number | null>(null)
  const [showShare, setShowShare]       = useState(false)
  const [showMenu, setShowMenu]         = useState(false)
  const [showReport, setShowReport]     = useState(false)
  const [editing, setEditing]           = useState(false)
  const [editContent, setEditContent]   = useState(post.content || '')
  const [editLoading, setEditLoading]   = useState(false)
  const [removeLinkPreview, setRemoveLinkPreview] = useState(false)
  // SP-2-19: local state (same convention as `saved` above) so every list
  // surface reflects the toggle without needing a wired `onUpdate` — missing/
  // undefined defaults enabled, matching the API's own backward-compat rule.
  const [commentsEnabled, setCommentsEnabled] = useState(post.comments_enabled !== false)
  const [sharingEnabled, setSharingEnabled]   = useState(post.sharing_enabled !== false)

  const longPressTimer    = useRef<ReturnType<typeof setTimeout>>()
  const longPressTriggered = useRef(false)

  const isMe    = user?.id === post.author?.id
  const authorPath = `/u/${post.author?.username}`
  const authorName = `${post.author?.first_name || ''} ${post.author?.last_name || ''}`.trim()
  const canEdit = isMe && ((Date.now() - new Date(post.created_at).getTime()) < 15 * 60 * 1000)

  function onPressStart() {
    longPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      setShowPicker(true)
    }, 400)
  }
  function onPressEnd() {
    clearTimeout(longPressTimer.current)
    if (!longPressTriggered.current) handleReact('like')
  }

  async function handleReact(type: string) {
    setShowPicker(false)
    const prev = reaction; const prevCount = reactionCount
    if (reaction === type) { setReaction(null); setCount(c => Math.max(0, c - 1)) }
    else { setReaction(type); if (!prev) setCount(c => c + 1) }
    setLikeAnim(true); setTimeout(() => setLikeAnim(false), 500)
    hapticTap()
    if (type === 'love' && reaction !== 'love') {
      setHearts(burstPieces(6)); setTimeout(() => setHearts([]), 700)
    }
    try { await postApi.react(post.id, type) }
    catch { setReaction(prev); setCount(prevCount) }
  }

  async function handleSave() {
    const prev = saved; setSaved(!saved)
    try { await postApi.save(post.id); toast.success(saved ? t('post.removed') : t('post.savedToast')) }
    catch { setSaved(prev) }
  }

  async function handleDelete() {
    setShowMenu(false)
    if (!confirm(t('post.deleteConfirm'))) return
    try { await postApi.delete(post.id); toast.success(t('post.deletedToast')); onDelete?.(post.id) }
    catch { toast.error(t('post.deleteError')) }
  }

  async function handleEdit() {
    if (!editContent.trim()) return
    setEditLoading(true)
    try {
      const edited = await (postApi as any).edit?.(post.id, editContent, { link_preview_dismissed: removeLinkPreview })
      if (!edited) toast.error(t('post.editEndpointMissing'))
      toast.success(t('post.updatedToast'))
      setEditing(false)
      setRemoveLinkPreview(false)
      // The server is authoritative on the resulting preview state — an
      // edit can clear/replace it purely from the content change itself,
      // independent of the dismiss flag, so the real response is used
      // rather than guessing from what was sent (found live: guessing here
      // left a stale card visible after removing a post's URL).
      onUpdate?.(post.id, { content: editContent, link_preview: edited.data?.data?.link_preview ?? null })
    } catch { toast.error(t('post.editFailed')) }
    finally { setEditLoading(false) }
  }

  // SP-2-19: server-authoritative — local state only changes on a
  // successful response, never optimistically, so a failed PATCH never
  // shows a false success state (the checkbox simply stays as it was).
  // Unlike the one-shot menu actions above, a toggle deliberately does NOT
  // close the menu — a checkbox-style control, and the owner may want to
  // flip both controls without reopening the menu twice.
  async function handleToggleControl(field: 'comments_enabled' | 'sharing_enabled') {
    const next = field === 'comments_enabled' ? !commentsEnabled : !sharingEnabled
    try {
      const res = await postApi.updateControls(post.id, { [field]: next })
      const result = !!res.data.data[field]
      if (field === 'comments_enabled') setCommentsEnabled(result)
      else setSharingEnabled(result)
      onUpdate?.(post.id, { [field]: result })
    } catch {
      toast.error(t('post.controlUpdateError'))
    }
  }

  // SP-11-07: this menu item bypasses ShareSheet entirely, so it needs its
  // own fresh server authorization immediately before the clipboard write —
  // the `sharingEnabled` check that gates whether this item even appears is
  // client state that can go stale the instant this menu is left open
  // (Section 7.2's stale-sheet requirement applies here too, not just inside
  // ShareSheet itself).
  async function handleMenuCopyLink() {
    setShowMenu(false)
    try {
      const res = await postApi.externalShare(post.id)
      await navigator.clipboard.writeText(res.data.data.url)
      toast.success(t('share.linkCopied'))
    } catch (err: any) {
      toast.error(err?.response?.status === 403 ? t('share.disabledError') : t('share.genericError'))
    }
  }

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime()
    if (diff < 60000) return t('post.justNow')
    if (diff < 3600000) return t('post.minutesShort', { n: String(Math.floor(diff/60000)) })
    if (diff < 86400000) return t('post.hoursShort', { n: String(Math.floor(diff/3600000)) })
    return t('post.daysShort', { n: String(Math.floor(diff/86400000)) })
  }

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        whileHover={{ boxShadow: 'var(--shadow)' }} transition={{ duration: 0.18 }}
        style={{ background: 'var(--white)', borderRadius: 'var(--r)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', marginBottom: 14, overflow: 'hidden', position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
          {/* SP-5-08: avatar and name are both real links to the same
              profile (the avatar's old onClick prop was silently ignored).
              The 2px padding/negative margin gives a 44px hit target while
              the visual footprint stays the 40px avatar — no layout shift. */}
          <Link to={authorPath} aria-label={t('avatar.viewProfile', { name: authorName })}
            data-testid="postcard-author-avatar"
            style={{ display: 'block', padding: 2, margin: -2, borderRadius: '50%', flexShrink: 0, textDecoration: 'none' }}>
            <Avatar src={post.author?.profile_pic_url} name={post.author?.first_name || 'U'} size="md" />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Link to={authorPath} data-testid="postcard-author-name"
                style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {authorName}
              </Link>
              <VerifiedBadge verified={post.author?.is_verified_badge} size={15} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text4)' }}>
              @{post.author?.username} · {timeAgo(post.created_at)}
              {post.location && <> · <MapPin size={12} aria-hidden style={{ verticalAlign: '-1px' }} /> {post.location}</>}
            </div>
          </div>
          {/* 3-dot menu — SP-5-04: shared Overlay primitive (mobile sheet /
              desktop centered dialog) instead of a hand-rolled absolute
              dropdown + full-screen click-catcher. */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu(!showMenu)}
              style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text4)', padding: '6px 10px', minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
              <Ellipsis size={18} aria-hidden />{t('post.more')}
            </button>
            <Overlay open={showMenu} onClose={() => setShowMenu(false)} ariaLabel={t('post.more')} maxWidth={340}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
              {[
                ...(sharingEnabled ? [{ icon: <LinkIcon size={18} aria-hidden />, label: t('share.copyLink'), action: handleMenuCopyLink }] : []),
                ...(canEdit ? [{ icon: <Pencil size={18} aria-hidden />, label: t('post.editPost'), action: () => { setEditing(true); setShowMenu(false) } }] : []),
                ...(isMe ? [{ icon: <Trash2 size={18} aria-hidden />, label: t('post.deletePost'), action: handleDelete, danger: true }] : [{ icon: <Flag size={18} aria-hidden />, label: t('post.report'), action: () => { setShowReport(true); setShowMenu(false) } }]),
              ].map((item: any) => (
                <button key={item.label} onClick={item.action}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: item.danger ? 'var(--danger)' : 'var(--text)', textAlign: 'left' }}>
                  <span style={{ display: 'flex', color: item.danger ? 'var(--danger)' : 'var(--text3)' }}>{item.icon}</span>{item.label}
                </button>
              ))}
              {/* SP-2-19: owner-only per-post controls — real checkbox/
                  switch semantics (role="switch"/aria-checked), works on
                  any post regardless of the 15-minute edit window. */}
              {isMe && [
                { field: 'comments_enabled' as const, label: t('post.allowComments'), checked: commentsEnabled },
                { field: 'sharing_enabled' as const, label: t('post.allowSharing'), checked: sharingEnabled },
              ].map(row => (
                <button key={row.field} role="switch" aria-checked={row.checked}
                  onClick={() => handleToggleControl(row.field)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', minHeight: 44, background: 'none', border: 'none', borderTop: '1px solid var(--divider)', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
                  <input type="checkbox" checked={row.checked} readOnly tabIndex={-1} style={{ pointerEvents: 'none' }} />
                  {row.label}
                </button>
              ))}
            </Overlay>
          </div>
        </div>

        {/* Content / Edit */}
        {editing ? (
          <div style={{ padding: '0 16px 12px' }}>
            <textarea value={editContent} onChange={e => setEditContent(e.target.value)} autoFocus rows={3}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--brand)', borderRadius: 10, fontSize: 14, color: 'var(--text)', outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.6 }} />
            {post.link_preview && !removeLinkPreview && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: 'var(--text4)', cursor: 'pointer' }}>
                <input type="checkbox" checked={false} onChange={() => setRemoveLinkPreview(true)} />
                {t('linkPreview.remove')} ({post.link_preview.hostname})
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setEditing(false); setRemoveLinkPreview(false) }} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>{t('share.cancel')}</button>
              <button onClick={handleEdit} disabled={editLoading}
                style={{ flex: 2, padding: '8px', borderRadius: 8, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {editLoading ? t('post.savingEllipsis') : t('post.save')}
              </button>
            </div>
          </div>
        ) : post.content && (
          <div style={{ padding: '0 16px 12px', fontSize: 14.5, color: 'var(--text2)', lineHeight: 1.6, cursor: 'pointer' }}
            onClick={() => navigate(`/p/${post.id}`)}>
            {renderContent(post.content)}
          </div>
        )}

        {/* SP-11-06: server-generated snapshot, taken at publish/edit time —
            never re-fetched on render, so a reader viewing this card never
            causes a new outbound fetch. */}
        {!editing && post.link_preview && (
          <div style={{ padding: '0 16px 12px' }}>
            <LinkPreviewCard preview={post.link_preview} />
          </div>
        )}

        {/* Wave 2: the author's own video post while it is checked, or after
            it could not be processed (never published; media removed). */}
        {isMe && (post.moderation_status === 'processing_failed' || (post.type === 'video' && post.moderation_status === 'pending')) && (
          <div data-testid="video-processing-notice" role={post.moderation_status === 'processing_failed' ? 'alert' : 'status'}
            style={{ margin: '0 16px 10px', padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.45,
              background: post.moderation_status === 'processing_failed' ? 'var(--danger-bg)' : 'var(--warning-bg)',
              color: post.moderation_status === 'processing_failed' ? 'var(--danger-strong)' : 'var(--warning-text)' }}>
            {t(post.moderation_status === 'processing_failed' ? 'video.processingFailed' : 'video.processing')}
          </div>
        )}

        {/* Media */}
        {post.media_urls?.length > 0 && !editing && post.moderation_status !== 'processing_failed' && (
          post.type === 'video'
            ? <VideoPlayer src={post.media_urls[0]} poster={post.thumb_url} />
            : (
              <div style={{ display: 'grid', gridTemplateColumns: post.media_urls.length === 1 ? '1fr' : '1fr 1fr', gap: 2 }}>
                {post.media_urls.slice(0, 4).map((url: string, i: number) => {
                  // SP-11-08: single image renders near the card's full ~640px
                  // width, a grid tile at roughly half that — both figures
                  // are real WIDTH_BUCKETS entries in mediaDelivery.ts, chosen
                  // to match. ImageViewer (opened below) always gets the
                  // untouched original, never a transformed thumbnail.
                  const delivery = buildDelivery(url, post.media_urls.length === 1 ? 640 : 320, dataSaver)
                  return (
                  <button type="button" key={i} aria-label={t('post.openPhoto', { index: String(i + 1), total: String(post.media_urls.length) })} style={{ position: 'relative', cursor: 'zoom-in', padding: 0, border: 'none', background: 'none', display: 'block', width: '100%' }} onClick={() => setImageViewer(i)}>
                    <img src={delivery.src} srcSet={delivery.srcSet || undefined} alt="" style={{ width: '100%', aspectRatio: post.media_urls.length === 1 ? '16/9' : '1', objectFit: 'cover', display: 'block' }} />
                    {i === 3 && post.media_urls.length > 4 && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff' }}>
                        +{post.media_urls.length - 4}
                      </div>
                    )}
                  </button>
                  )
                })}
              </div>
            )
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: '10px 12px 12px', borderTop: '1px solid var(--divider)', position: 'relative' }}>
          {/* Reaction picker — SP-5-04: shared Overlay primitive (mobile
              sheet / desktop compact centered dialog) instead of a
              hover-anchored popover with no focus management. */}
          <Overlay open={showPicker} onClose={() => setShowPicker(false)} ariaLabel={t('post.like')} maxWidth={320}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
              {REACTIONS.map((r, i) => (
                <motion.button key={r.type}
                  initial={{ scale: 0, y: 8 }} animate={{ scale: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  whileHover={{ scale: 1.2, y: -4 }} whileTap={{ scale: 0.9 }}
                  aria-label={r.type}
                  onClick={() => handleReact(r.type)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, padding: 8, minWidth: 44, minHeight: 44, lineHeight: 1 }}>
                  {r.emoji}
                </motion.button>
              ))}
            </div>
          </Overlay>

          {/* Heart burst — shared SP-5-02 burst preset */}
          {hearts.map(piece => (
            <motion.span key={piece.id} initial={{ opacity: 1, scale: 0, x: 0, y: 0 }} animate={{ opacity: 0, scale: 1.5, x: piece.x, y: piece.y }} transition={burstTransition}
              style={{ position: 'absolute', left: 20, bottom: 20, fontSize: 16, pointerEvents: 'none', zIndex: 5 }}>❤️</motion.span>
          ))}

          <motion.button onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerLeave={() => clearTimeout(longPressTimer.current)}
            animate={likeAnim ? { scale: [1, 1.4, 1] } : {}} transition={{ duration: 0.3 }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 6px', minHeight: 44, borderRadius: 8, background: reaction ? 'var(--brand-light)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: reaction ? 'var(--link)' : 'var(--text3)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {reaction
              ? <span aria-hidden style={{ fontSize: 16 }}>{reactionEmoji(reaction)}</span>
              : <ThumbsUp size={18} aria-hidden />}
            {reaction ? t('post.liked') : t('post.like')}{reactionCount > 0 && ` ${reactionCount}`}
          </motion.button>

          <button onClick={() => navigate(`/p/${post.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 6px', minHeight: 44, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
            <MessageCircle size={18} aria-hidden />{t('post.comment')}{post.comment_count > 0 && ` ${post.comment_count}`}
          </button>

          <motion.button whileTap={PRESS_TAP} onClick={handleSave} aria-label={saved ? t('post.savedPost') : t('post.savePost')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 6px', minHeight: 44, borderRadius: 8, background: saved ? 'var(--brand-light)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: saved ? 'var(--link)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
            <Bookmark size={18} aria-hidden fill={saved ? 'currentColor' : 'none'} />{saved ? t('post.saved') : t('post.save')}
          </motion.button>

          {sharingEnabled && (
            <motion.button whileTap={PRESS_TAP} onClick={() => setShowShare(true)}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '6px 6px', minHeight: 44, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
              <Share2 size={18} aria-hidden />{t('post.share')}
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* SP-5-10: on-demand dialogs load as their own chunks (first tap). */}
      <Suspense fallback={null}>
      {imageViewer !== null && <ImageViewer images={post.media_urls} initialIndex={imageViewer} onClose={() => setImageViewer(null)} />}
      {showShare && <ShareSheet postId={post.id} content={post.content} sharingEnabled={sharingEnabled} onClose={() => setShowShare(false)} />}
      {showReport && <ReportModal targetType="post" targetId={post.id} onClose={() => setShowReport(false)} />}
      </Suspense>
    </>
  )
}

function renderContent(content: string) {
  return content.split(/(#\w+|@\w+)/g).map((part, i) => {
    // SP-5-15: real links (keyboard + screen reader), not click-only spans.
    if (part.startsWith('#')) return <Link key={i} to={`/tag/${part.slice(1)}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--link)', fontWeight: 600, textDecoration: 'none' }}>{part}</Link>
    if (part.startsWith('@')) return <Link key={i} to={`/u/${part.slice(1)}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{part}</Link>
    return <span key={i}>{part}</span>
  })
}
