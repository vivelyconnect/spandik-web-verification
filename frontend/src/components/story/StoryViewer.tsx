// src/components/story/StoryViewer.tsx
import { useState, useEffect, useRef } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useEasyMode } from '../../stores/authStore'
import { postApi } from '../../utils/api'
import Avatar from '../ui/Avatar'
import { useT } from '../../i18n/useT'
import { Pause, Play, Smile, X } from 'lucide-react'
import { useDataSaverStore } from '../../stores/dataSaverStore'
import { buildDelivery } from '../../utils/mediaDelivery'
import { apiAgeMs } from '../../utils/time'

// SP-11-07: present (object or null) only when this story is itself a
// share-to-story (repost_id set on the underlying post) — see
// api/src/routes/posts.ts's GET /posts/stories batch hydration. `null`
// means the source became unavailable (deleted/visibility tightened) since
// the share was created — a distinct, explicit state from "not a share at
// all", never silently dropped.
interface SharedPostCard {
  id: string
  content: string | null
  type: string
  media_url: string | null
  author: { id: string; username: string; first_name: string; last_name: string; profile_pic_url: string | null }
}

interface Story {
  moderation_status?: string
  id: string
  media_urls: string[]
  content: string | null
  author: { id: string; username: string; first_name: string; profile_pic_url: string | null }
  created_at: string
  type: string
  repost_id?: string | null
  shared_post?: SharedPostCard | null
}

interface StoryGroup {
  user: { id: string; username: string; first_name: string; profile_pic_url: string | null }
  stories: Story[]
}

interface StoryViewerProps {
  groups: StoryGroup[]
  initialGroupIndex?: number
  onClose: () => void
}

const STORY_DURATION = 5000 // 5 seconds per story

export default function StoryViewer({ groups, initialGroupIndex = 0, onClose }: StoryViewerProps) {
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const t = useT()
  const dataSaver = useDataSaverStore(s => s.enabled)
  // SP-5-07: Easy Mode = no autoplay — no timed auto-advance, and videos
  // wait for the person to press play.
  const easyMode = useEasyMode()
  const [groupIdx, setGroupIdx]   = useState(initialGroupIndex)
  const [storyIdx, setStoryIdx]   = useState(0)
  const [progress, setProgress]   = useState(0)
  const [paused, setPaused]       = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [reacted, setReacted]     = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  const startTime   = useRef(Date.now())

  const group = groups[groupIdx]
  const story = group?.stories[storyIdx]

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // SP-5-15: next/previous were tap-only — keyboard users get the same
  // actions (→ next, ← previous, Esc close).
  const keyActions = useRef({ advance: () => {}, goBack: () => {}, onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') keyActions.current.advance()
      else if (e.key === 'ArrowLeft') keyActions.current.goBack()
      else if (e.key === 'Escape') keyActions.current.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!story) return
    setProgress(0)
    startTime.current = Date.now()
    clearInterval(intervalRef.current)
    if (!paused && !easyMode) {
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime.current
        const pct = Math.min((elapsed / STORY_DURATION) * 100, 100)
        setProgress(pct)
        if (pct >= 100) advance()
      }, 50)
    }
    return () => clearInterval(intervalRef.current)
  }, [storyIdx, groupIdx, paused, easyMode])

  function advance() {
    clearInterval(intervalRef.current)
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(s => s + 1)
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx(g => g + 1)
      setStoryIdx(0)
    } else {
      onClose()
    }
  }

  function goBack() {
    clearInterval(intervalRef.current)
    if (storyIdx > 0) {
      setStoryIdx(s => s - 1)
    } else if (groupIdx > 0) {
      setGroupIdx(g => g - 1)
      setStoryIdx(0)
    }
  }

  keyActions.current = { advance, goBack, onClose }

  function handleTap(e: React.MouseEvent) {
    const { clientX, currentTarget } = e
    const { width } = currentTarget.getBoundingClientRect()
    if (clientX < width * 0.3) goBack()
    else advance()
  }

  async function handleReact(type: string) {
    if (!story) return
    setReacted(type)
    setShowReactions(false)
    try { await postApi.react(story.id, type) } catch {}
  }

  const timeAgo = (d: string) => {
    const diff = apiAgeMs(d)
    if (Number.isNaN(diff)) return ''
    if (diff < 3600000) return t('story.minutesAgo', { n: String(Math.floor(diff/60000)) })
    return t('story.hoursAgo', { n: String(Math.floor(diff/3600000)) })
  }

  if (!group || !story) return null

  const isVideo = isVideoStoryUrl(story.type, story.media_urls?.[0])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: '#000',
          display: 'flex', flexDirection: 'column',
          maxWidth: 480, margin: '0 auto',
        }}
      >
        {/* Progress bars */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          padding: '12px 8px 0',
          display: 'flex', gap: 3,
          background: 'linear-gradient(rgba(0,0,0,0.4), transparent)',
        }}>
          {group.stories.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 2.5, background: 'rgba(255,255,255,0.35)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                background: '#fff',
                width: i < storyIdx ? '100%' : i === storyIdx ? `${progress}%` : '0%',
                transition: i === storyIdx ? 'none' : 'none',
              }} />
            </div>
          ))}
        </div>

        {/* Header */}
        <div style={{
          position: 'absolute', top: 24, left: 0, right: 0, zIndex: 10,
          padding: '0 12px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Avatar src={group.user.profile_pic_url} name={group.user.first_name} size={34} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{group.user.first_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>@{group.user.username} · {timeAgo(story.created_at)}</div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); setPaused(p => !p) }}
            aria-label={paused ? t('media.play') : t('media.pause')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 10, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
          </button>
          <button onClick={onClose} aria-label={t('overlay.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 10, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={24} aria-hidden /></button>
        </div>

        {/* Story media — tap zones */}
        <div style={{ flex: 1, position: 'relative' }} onClick={handleTap}>
          <AnimatePresence mode="wait">
            <motion.div key={`${groupIdx}-${storyIdx}`}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ position: 'absolute', inset: 0 }}
            >
              {group.user.id === user?.id && (story.moderation_status === 'processing_failed' || (isVideo && story.moderation_status === 'pending')) && (
                <div data-testid="video-processing-notice" role={story.moderation_status === 'processing_failed' ? 'alert' : 'status'}
                  style={{ position: 'absolute', left: 12, right: 12, bottom: 90, zIndex: 2, padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.45, background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
                  {t(story.moderation_status === 'processing_failed' ? 'video.processingFailed' : 'video.processing')}
                </div>
              )}
              {story.media_urls?.[0] && story.moderation_status !== 'processing_failed' ? (
                isVideo ? (
                  <video src={story.media_urls[0]} autoPlay={!easyMode} controls={easyMode} muted playsInline
                    data-testid="story-video"
                    onClick={e => { if (easyMode) e.stopPropagation() }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <img src={story.media_urls[0]} alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: 'linear-gradient(135deg, var(--brand), var(--accent))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 32, textAlign: 'center',
                }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>{story.content}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Text overlay */}
          {story.content && story.media_urls?.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 80, left: 16, right: 16,
              background: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: '10px 14px',
              backdropFilter: 'blur(4px)',
            }}>
              <p style={{ fontSize: 14, color: '#fff', lineHeight: 1.5, margin: 0 }}>{story.content}</p>
            </div>
          )}
          {/* SP-11-07: shared source-post card — tap navigates to /p/:id,
              never counted as a left/right nav-zone tap (stopPropagation). */}
          {story.repost_id && (
            <div
              onClick={e => { e.stopPropagation(); if (story.shared_post) navigate(`/p/${story.shared_post.id}`) }}
              style={{
                position: 'absolute', bottom: 92, left: 16, right: 16,
                background: 'rgba(0,0,0,0.55)', borderRadius: 14, padding: 10,
                backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.15)',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: story.shared_post ? 'pointer' : 'default',
              }}
            >
              {story.shared_post ? (
                <>
                  <Avatar src={story.shared_post.author.profile_pic_url} name={story.shared_post.author.first_name} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
                      {story.shared_post.author.first_name} {story.shared_post.author.last_name}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {story.shared_post.content || (story.shared_post.type === 'video' ? t('story.video') : t('story.photo'))}
                    </div>
                  </div>
                  {story.shared_post.media_url && (() => {
                    // buildDelivery fails closed for the private/?mt= URLs
                    // getPrivateMediaUrl produces — this only ever rewrites
                    // an already-public media.spandik.com URL.
                    const thumbDelivery = buildDelivery(story.shared_post.media_url, 40, dataSaver)
                    return <img src={thumbDelivery.src} srcSet={thumbDelivery.srcSet || undefined} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  })()}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>{t('share.unavailable')}</div>
              )}
            </div>
          )}
        </div>

        {/* Bottom — reaction bar */}
        <div style={{
          padding: '12px 16px 24px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowReactions(r => !r)}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 99,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', fontSize: 13.5, cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {reacted ? (
              <span style={{ fontSize: 20 }}>{reactionEmoji(reacted)}</span>
            ) : (
              <><Smile size={18} aria-hidden /> <span>{t('story.reactToStory')}</span></>
            )}
          </motion.button>
        </div>

        {/* Reaction picker */}
        <AnimatePresence>
          {showReactions && (
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              style={{
                position: 'absolute', bottom: 70, left: 16, right: 16,
                background: 'rgba(20,20,20,0.95)', borderRadius: 16,
                padding: '12px', display: 'flex', justifyContent: 'space-around',
                backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {REACTIONS.map((r, i) => (
                <motion.button key={r.type}
                  initial={{ scale: 0, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  whileHover={{ scale: 1.3, y: -4 }} whileTap={{ scale: 0.9 }}
                  onClick={() => handleReact(r.type)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, padding: 4 }}>
                  {r.emoji}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Group navigation dots */}
        {groups.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 4,
          }}>
            {groups.map((_, i) => (
              <div key={i} style={{
                width: i === groupIdx ? 16 : 5, height: 5, borderRadius: 3,
                background: i === groupIdx ? '#fff' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.2s',
              }} />
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

const REACTIONS = [
  { type: 'like', emoji: '👍' }, { type: 'love', emoji: '❤️' },
  { type: 'haha', emoji: '😂' }, { type: 'wow', emoji: '😮' },
  { type: 'sad', emoji: '😢' }, { type: 'angry', emoji: '😡' },
  { type: 'respect', emoji: '🙏' },
]

function reactionEmoji(type: string): string {
  return REACTIONS.find(r => r.type === type)?.emoji || '👍'
}

// Stories are created as type 'story' (not 'video'), so the media URL is the
// signal. A still-pending or friends/private story is served through
// /media/serve/<key>?mt=<token> — the extension is followed by a query
// string, which the old `$`-anchored check missed, rendering the video as a
// broken <img>.
export function isVideoStoryUrl(type: string | undefined, url: string | undefined): boolean {
  const path = (url || '').split(/[?#]/)[0]
  return type === 'video' || /\.(mp4|webm|mov)$/i.test(path)
}
