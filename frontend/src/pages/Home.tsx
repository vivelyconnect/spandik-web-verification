// src/pages/Home.tsx
import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'
import { m as motion, AnimatePresence } from 'framer-motion'
import { postApi, userApi, mediaApi } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import PostCard from '../components/post/PostCard'
import Avatar from '../components/ui/Avatar'
import MentionInput from '../components/ui/MentionInput'
const StoryViewer = lazy(() => import('../components/story/StoryViewer'))
import toast from 'react-hot-toast'
import { compressImage, validateVideo, VIDEO_ACCEPT } from '../utils/mediaCompress'
import { useT } from '../i18n/useT'
import PullToRefresh from '../motion/PullToRefresh'
import { listContainerVariants, listItemVariants } from '../motion/presets'
import { saveLastFeed, loadLastFeed } from '../utils/feedCache'
import { useIsOffline } from '../pwa/pwa'

const DRAFT_KEY = 'spandik_post_draft'

export default function Home() {
  const user    = useAuthStore(s => s.user)
  const qc      = useQueryClient()
  const t = useT()
  const { ref, inView } = useInView()
  const online = !useIsOffline()

  const [composing, setComposing]     = useState(false)
  const [content, setContent]         = useState(() => localStorage.getItem(DRAFT_KEY) || '')
  const [posting, setPosting]         = useState(false)
  const [storyGroups, setStoryGroups] = useState<any[]>([])
  const storyInput = useRef<HTMLInputElement>(null)
  const [storyViewerIdx, setStoryViewerIdx] = useState<number | null>(null)

  // Auto-save draft
  useEffect(() => {
    if (content) localStorage.setItem(DRAFT_KEY, content)
    else localStorage.removeItem(DRAFT_KEY)
  }, [content])

  // Stories
  const { data: storiesData } = useQuery({
    queryKey: ['stories'],
    queryFn: () => postApi.stories().then(r => r.data.data || []),
  })

  useEffect(() => {
    if (storiesData) setStoryGroups(storiesData)
  }, [storiesData])

  async function handleStoryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      // SP-2-15: compress images client-side before upload; video only
      // gets a duration/size check (no client transcoding, per spec).
      let uploadFile = file
      if (file.type.startsWith('video/')) {
        const v = await validateVideo(file)
        if (!v.ok) { toast.error(v.error ? t(v.error, v.vars) : t('feed.videoRejected')); return }
      } else if (file.type.startsWith('image/')) {
        const r = await compressImage(file)
        uploadFile = r.file
      }
      const res = await mediaApi.upload(uploadFile, 'story')
      const key = res.data.data?.key
      if (!key) return
      await postApi.create({ type: 'story', is_story: true, media_keys: [key] })
      toast.success(t('feed.storyPosted'))
      qc.invalidateQueries({ queryKey: ['stories'] })
    } catch (err: any) { toast.error(err?.message || t('feed.storyPostError')) }
  }

  // Feed — infinite scroll, cursor-based (SP-2-02): each page carries the
  // opaque cursor for the next one, immune to the classic offset bug where
  // a new post arriving mid-scroll shifts every later page by one.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }: { pageParam?: string }) => postApi.feed(pageParam).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: { posts: any[]; next_cursor: string | null }) => lastPage?.next_cursor ?? undefined,
  })

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [inView, hasNextPage, isFetchingNextPage])

  const posts = data?.pages.flatMap(p => p.posts) || []

  // SP-5-09: keep a privacy-filtered copy of the latest feed for offline
  // reading (public + approved only, this account only — see feedCache.ts),
  // and show it when the live feed can't load.
  useEffect(() => {
    if (user?.id && data?.pages?.[0]) saveLastFeed(user.id, data.pages[0].posts)
  }, [data, user?.id])
  const offlineFeed = !data && (isError || !online) && user?.id ? loadLastFeed(user.id) : null

  const createPost = useMutation({
    mutationFn: () => postApi.create({ type: 'text', content }),
    onSuccess: () => {
      setContent('')
      setComposing(false)
      localStorage.removeItem(DRAFT_KEY)
      qc.invalidateQueries({ queryKey: ['feed'] })
      toast.success(t('feed.postPublished'))
    },
    onError: () => toast.error(t('feed.postError')),
  })

  const hasDraft = !!localStorage.getItem(DRAFT_KEY) && !composing

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 24px' }}>

      {/* Hidden story file input */}
      <input ref={storyInput} type="file" accept={`image/*,${VIDEO_ACCEPT}`} style={{ display: 'none' }} onChange={handleStoryUpload} />

      {/* Stories row */}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', marginBottom: 16, paddingBottom: 4, scrollbarWidth: 'none', height: 160 }}>
        {/* Add story */}
        <StoryBubble
          src={user?.profile_pic_url} name="" isAdd
          onClick={() => storyInput.current?.click()}
        />
        {storyGroups.map((group: any, i: number) => (
          <StoryBubble
            key={group.user.id}
            src={group.stories?.[0]?.media_urls?.[0] || group.user.profile_pic_url}
            avatarSrc={group.user.profile_pic_url}
            name={group.user.first_name}
            // SP-5-08: every group /posts/stories returns has >=1 unexpired,
            // visible story (server-filtered) — that IS the authoritative
            // active-story state. There is no viewed/unviewed field, so no
            // viewed/subdued ring is invented.
            hasStory={(group.stories?.length ?? 0) > 0}
            onClick={() => setStoryViewerIdx(i)}
          />
        ))}
      </div>

      {/* Quick compose — just triggers AppShell modal. SP-5-19 remediation:
          real semantic button (was a click-only div) so this trigger is
          keyboard-reachable and the shared Overlay can restore focus to it
          on composer close, same as the desktop/mobile nav triggers. */}
      <motion.button type="button" whileHover={{ boxShadow: 'var(--shadow)' }}
        aria-label={t('post.createTitle')}
        style={{ width: '100%', textAlign: 'left', background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow-sm)', padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', font: 'inherit' }}
        onClick={() => document.dispatchEvent(new CustomEvent('spandik:open-compose'))}>
        <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={36} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 99, padding: '10px 16px', fontSize: 14, color: 'var(--text4)' }}>
          {t('feed.whatsOnYourMind', { name: user?.first_name || '' })}
        </div>
      </motion.button>

      {/* Feed — SP-5-02: pull-to-refresh ("spandan" heartbeat pulse) wraps
          the whole feed section; the ONE pull-to-refresh implementation in
          the app, reused here rather than a page-specific one-off. */}
      <PullToRefresh onRefresh={() => refetch()}>
        {offlineFeed && offlineFeed.posts.length > 0 ? (
          <div data-testid="offline-feed">
            <div role="status" style={{ fontSize: 13, color: 'var(--text3)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', marginBottom: 12 }}>
              {t('pwa.savedFeed', { time: new Date(offlineFeed.savedAt).toLocaleString() })}
            </div>
            {offlineFeed.posts.map((post: any) => <PostCard key={post.id} post={post} />)}
          </div>
        ) : isLoading ? (
          <FeedSkeleton />
        ) : posts.length === 0 ? (
          <EmptyFeed />
        ) : (
          <motion.div initial="hidden" animate="show" variants={listContainerVariants}>
            {posts.map((post: any) => (
              <motion.div key={post.id} variants={listItemVariants}>
                <PostCard
                  post={post}
                  onDelete={(id) => qc.setQueryData(['feed'], (old: any) => ({
                    ...old,
                    pages: old?.pages?.map((page: any) => ({ ...page, posts: page.posts.filter((p: any) => p.id !== id) }))
                  }))}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </PullToRefresh>

      {/* Infinite scroll sentinel */}
      <div ref={ref} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isFetchingNextPage && <div style={{ fontSize: 13, color: 'var(--text4)' }}>{t('feed.loadingMore')}</div>}
      </div>

      {/* Story viewer */}
      {storyViewerIdx !== null && storyGroups.length > 0 && (
        <Suspense fallback={null}><StoryViewer
          groups={storyGroups}
          initialGroupIndex={storyViewerIdx}
          onClose={() => setStoryViewerIdx(null)}
        /></Suspense>
      )}
    </div>
  )
}

function StoryBubble({ src, avatarSrc, name, isAdd, hasStory, onClick }: {
  src?: string | null; avatarSrc?: string | null; name: string; isAdd?: boolean; hasStory?: boolean; onClick?: () => void
}) {
  const t = useT()
  return (
    <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={onClick}
      aria-label={isAdd ? t('feed.addStory') : hasStory ? t('story.view', { name }) : name}
      style={{ flexShrink: 0, cursor: 'pointer', width: 96, height: 148, borderRadius: 14, overflow: 'hidden', position: 'relative', boxShadow: 'var(--shadow)', border: 'none', padding: 0, font: 'inherit', background: 'none' }}>
      {/* Background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: src
          ? `url(${src}) center/cover no-repeat`
          : isAdd
            ? 'var(--bg2)'
            : 'linear-gradient(135deg, var(--brand), var(--accent))',
      }} />
      {/* Overlay */}
      {!isAdd && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)' }} />}
      {/* Owner avatar — SP-5-08: the person's own profile photo (was the
          story media itself), with the shared story ring drawn inside a
          fixed 36px box, so it can never clip or shift the card. */}
      {!isAdd && (
        <Avatar src={avatarSrc} name={name} size={36} ring={hasStory}
          style={{ position: 'absolute', top: 8, left: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      )}
      {/* Add icon */}
      {isAdd && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--sidebar-bg)', fontWeight: 700 }}><Plus size={22} strokeWidth={2.5} aria-hidden /></div>
        </div>
      )}
      {/* Name */}
      <div style={{ position: 'absolute', bottom: 8, left: 6, right: 6, fontSize: 11, fontWeight: 600, color: isAdd ? 'var(--text)' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: isAdd ? 'none' : '0 1px 3px rgba(0,0,0,0.5)' }}>
        {isAdd ? t('feed.addStory') : name}
      </div>
    </motion.button>
  )
}

function FeedSkeleton() {
  return (
    <>{[1,2,3].map(i => (
      <div key={i} style={{ background: 'var(--white)', borderRadius: 'var(--r)', border: '1px solid var(--border)', marginBottom: 14, padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div className="skeleton-bone" style={{ width: 38, height: 38, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-bone" style={{ height: 12, width: '40%', borderRadius: 6, marginBottom: 6 }} />
            <div className="skeleton-bone" style={{ height: 10, width: '25%', borderRadius: 6 }} />
          </div>
        </div>
        <div className="skeleton-bone" style={{ height: 14, width: '90%', borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-bone" style={{ height: 14, width: '70%', borderRadius: 6 }} />
      </div>
    ))}</>
  )
}

// SP-11-01: Section 10/38's real bug — this button previously had no
// onClick handler at all, a dead primary CTA. Fixed by navigating to the
// canonical Explore route (the same architecture-safe destination the
// starter-content section below reuses via the API). Section 36/37: when
// the organic followed feed is empty, this also shows real, safe public
// discovery content (GET /posts/explore, unchanged — same moderation/
// authz/visibility filtering Explore itself uses) instead of a dead end,
// clearly labelled so it's never mistaken for followed-feed content.
function EmptyFeed() {
  const t = useT()
  const navigate = useNavigate()

  const { data: discoverPosts, isLoading } = useQuery({
    queryKey: ['home-discover'],
    queryFn: () => postApi.explore().then(r => (r.data.data || []).slice(0, 6)),
  })

  return (
    <div>
      <div style={{ textAlign: 'center', padding: '60px 20px 32px' }}>
        <Sparkles size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--link)' }} />
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t('feed.emptyTitle')}</div>
        <div style={{ color: 'var(--text3)', marginBottom: 24 }}>{t('feed.emptyBody')}</div>
        <button onClick={() => navigate('/explore')}
          style={{ padding: '12px 28px', minHeight: 44, borderRadius: 99, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
          {t('feed.exploreSpandik')}
        </button>
      </div>

      {!isLoading && discoverPosts && discoverPosts.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, padding: '0 4px' }}>
            {t('feed.discoverTitle')}
          </div>
          {discoverPosts.map((post: any) => <PostCard key={post.id} post={post} />)}
        </div>
      )}
    </div>
  )
}
