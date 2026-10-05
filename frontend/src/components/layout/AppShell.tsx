// src/components/layout/AppShell.tsx
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { m as motion, AnimatePresence } from 'framer-motion'
import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore, useEasyMode } from '../../stores/authStore'
import { Bell, Bookmark, CalendarDays, ChevronDown, Compass, Globe, House, Image as ImageIcon, Lock, LogOut, MessageCircle, Plus, Settings as SettingsIcon, UserRound, UsersRound, Video } from 'lucide-react'
import WelcomeExperience, { consumeFreshLogin, welcomeMode as welcomeModeFor } from '../welcome/WelcomeExperience'
import { usePrefersReducedMotion } from '../../motion/prefs'
import { useDataSaverStore } from '../../stores/dataSaverStore'
import { authApi, postApi, chatApi, notifApi, mediaApi } from '../../utils/api'
import { usePresence } from '../../hooks/usePresence'
import {
  parseLiveNotificationEvent, BoundedIdSet, bumpNotifBadgeCache, prependToNotificationsCache,
  type NotifBadgeCache, type NotificationsListCache,
} from '../../hooks/liveNotifications'
import { parseIncomingCallEvent, parseCallResolvedEvent } from '../../hooks/incomingCall'
import { useCallStore } from '../../stores/callStore'
const IncomingCallOverlay = lazy(() => import('../call/IncomingCallOverlay'))
import PwaBanners from '../../pwa/PwaBanners'
import Avatar from '../ui/Avatar'
import MentionInput from '../ui/MentionInput'
import LinkPreviewCard from '../post/LinkPreviewCard'
import { useLinkPreview } from '../../hooks/useLinkPreview'
import Wordmark from '../ui/Wordmark'
import Overlay from '../ui/Overlay'
import Footer from './Footer'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { compressImage, validateVideo, formatBytes, VIDEO_ACCEPT } from '../../utils/mediaCompress'
import { useT } from '../../i18n/useT'
import type { StringKey } from '../../i18n/strings'
import { tabIndicatorTransition, PRESS_TAP } from '../../motion/presets'
import { hapticTap } from '../../motion/haptics'
import { useCelebrationStore } from '../../stores/celebrationStore'
import { installKeyboardDetector } from '../../utils/keyboardViewport'

const DESKTOP_NAV: { to: string; key: StringKey }[] = [
  { to: '/',        key: 'nav.home'       },
  { to: '/explore', key: 'nav.explore'    },
  { to: '/chats',   key: 'nav.chats'      },
  { to: '/connect', key: 'nav.liveConnect'},
  { to: '/friends', key: 'nav.friends'    },
  { to: '/events/new', key: 'nav.events'  },
]

export default function AppShell() {
  const user     = useAuthStore(s => s.user)
  const easyMode = useEasyMode()
  // SP-5-11: the welcome sequence plays once, right after a fresh login
  // (flag set by Login.tsx, consumed here) — never on reload/app open.
  const reducedMotion = usePrefersReducedMotion()
  const dataSaverOn = useDataSaverStore(s => s.enabled)
  const [welcomeMode, setWelcomeMode] = useState<'cinematic' | 'static' | null>(null)
  useEffect(() => {
    if (!consumeFreshLogin()) return
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } }
    setWelcomeMode(welcomeModeFor({
      reducedMotion, dataSaver: dataSaverOn, easyMode,
      deviceMemory: nav.deviceMemory, saveData: nav.connection?.saveData, effectiveType: nav.connection?.effectiveType,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const logout   = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const location = useLocation()
  const t        = useT()

  // SP-3-02: bounded dedup — survives across reconnects within this mount
  // (never recreated per-render) but never grows without bound. Guards
  // against a queue-retried push (same notification id) producing a second
  // toast/badge-increment in this tab.
  const notifDedupRef = useRef<BoundedIdSet | null>(null)
  if (!notifDedupRef.current) notifDedupRef.current = new BoundedIdSet(200)

  const setIncomingCall = useCallStore(s => s.setIncoming)
  const setCallResolved = useCallStore(s => s.setResolved)

  const handlePresenceServerEvent = useCallback((raw: unknown) => {
    // SP-3-05: call-control envelopes are a separate discriminator
    // (`event`, never `type`) from live notifications — checked first so a
    // malformed/unrelated frame never falls through into the notification
    // parser (or vice versa).
    const incomingCall = parseIncomingCallEvent(raw)
    if (incomingCall) { setIncomingCall(incomingCall); return }
    const resolved = parseCallResolvedEvent(raw)
    if (resolved) { setCallResolved(resolved); return }

    const notification = parseLiveNotificationEvent(raw)
    if (!notification) return // malformed/unknown event type — ignore

    // Already reflected in the loaded notifications list (e.g. this tab
    // just fetched it another way) — treat as already-known, no double count.
    const existingList = qc.getQueryData<NotificationsListCache>(['notifications'])
    if (existingList?.notifications.some(n => n.id === notification.id)) return
    if (!notifDedupRef.current!.addIfNew(notification.id)) return // duplicate delivery in this tab

    toast(notification.message)
    qc.setQueryData<NotifBadgeCache>(['notif-badge'], prev => bumpNotifBadgeCache(prev))
    qc.setQueryData<NotificationsListCache>(['notifications'], prev => prependToNotificationsCache(prev, notification))
  }, [qc, setIncomingCall, setCallResolved])

  // SP-3-01/SP-3-02: one global presence WebSocket for the whole
  // authenticated app lifecycle — independent from any per-chat ChatRoom
  // socket (useChat.ts). Also carries live-pushed notification events over
  // the same connection (no second socket).
  usePresence(handlePresenceServerEvent)

  // Badge counts — poll every 30s for unread chats + notifications
  const { data: threadsData } = useQuery({
    queryKey: ['chat-threads-badge'],
    queryFn: () => chatApi.threads().then(r => r.data),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  })
  const { data: notifData } = useQuery({
    queryKey: ['notif-badge'],
    queryFn: () => notifApi.list().then(r => r.data),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 15000,
  })
  // Software-keyboard detection for the whole shell (html.kb-open).
  useEffect(() => installKeyboardDetector(), [])

  const totalUnreadChat = (threadsData?.data as any[])?.reduce((sum: number, t: any) => sum + (t.unread_count || 0), 0) || 0
  const totalUnreadNotif = (notifData?.data?.unread_count as number) || 0

  const [creating, setCreating]     = useState(false)
  const [postContent, setPostContent] = useState('')
  const [posting, setPosting]       = useState(false)
  const [showDesktopMenu, setShowDesktopMenu] = useState(false)
  const [showMobileSheet, setShowMobileSheet] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 66, right: 16 })
  const avatarBtnRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [mediaSizes, setMediaSizes] = useState<{ original: number; compressed: number }[]>([])
  const [compressing, setCompressing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [visibility, setVisibility] = useState<'public'|'friends'|'private'>('public')
  // SP-2-19: creation-time controls, default ON for every new composition.
  const [commentsEnabled, setCommentsEnabled] = useState(true)
  const [sharingEnabled, setSharingEnabled] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Sets `accept` on the element itself before opening: a ref-driven prop
  // only reached the DOM on the next render, so the Video button used to
  // open a photos-only picker (mobile pickers honour `accept`).
  const openFilePicker = (accept: string) => {
    if (!fileInputRef.current) return
    fileInputRef.current.accept = accept
    fileInputRef.current.click()
  }

  // SP-11-06/SP-11-06R: shared preview-generation hook (also used by the
  // root comment composer and reply boxes — see hooks/useLinkPreview.ts).
  const linkPreview = useLinkPreview(postContent)

  // SP-2-15: images are resized/re-encoded client-side before they ever
  // leave the device; video only gets a duration/size check here (no client
  // transcoding, per spec) since actual compression would need a much
  // heavier tool than a canvas re-encode.
  async function handleFilesPicked(files: File[]) {
    if (files.length === 0) return
    setCompressing(true)
    try {
      const results: File[] = []
      const sizes: { original: number; compressed: number }[] = []
      for (const file of files) {
        if (file.type.startsWith('video/')) {
          const v = await validateVideo(file)
          if (!v.ok) { toast.error(v.error ? t(v.error, v.vars) : t('composer.videoRejected')); continue }
          results.push(file)
          sizes.push({ original: file.size, compressed: file.size })
          continue
        }
        try {
          const r = await compressImage(file)
          results.push(r.file)
          sizes.push({ original: r.originalBytes, compressed: r.compressedBytes })
        } catch (err: any) {
          toast.error(err?.message || t('composer.imageProcessFailed'))
        }
      }
      setMediaFiles(results)
      setMediaSizes(sizes)
    } finally {
      setCompressing(false)
    }
  }

  useEffect(() => { setShowDesktopMenu(false); setShowMobileSheet(false) }, [location.pathname])

  // SP-5-19: Home's quick-compose card dispatches this event, but nothing
  // ever listened for it — the trigger was a dead click. This is the one
  // listener for the app-level open-compose contract every composer trigger
  // (desktop "＋ Post", mobile "＋", Home quick-compose) now shares.
  useEffect(() => {
    function onOpenCompose() { setCreating(true) }
    document.addEventListener('spandik:open-compose', onOpenCompose)
    return () => document.removeEventListener('spandik:open-compose', onOpenCompose)
  }, [])

  function closeComposer() {
    setCreating(false)
    setPostContent('')
    setMediaFiles([])
    setMediaSizes([])
    setVisibility('public')
    setCommentsEnabled(true)
    setSharingEnabled(true)
    linkPreview.reset()
  }

  function openDesktopMenu() {
    if (avatarRef.current) {
      const rect = avatarRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    }
    setShowDesktopMenu(v => !v)
  }

  async function handleLogout() {
    try { await authApi.logout({ all_devices: false }) } catch {}
    logout({ keepChatKeys: true }) // trusted device: the wrapped chat key stays
    navigate('/login')
  }

  async function handlePost() {
    if (!postContent.trim() && mediaFiles.length === 0) return
    setPosting(true)
    setUploadProgress(mediaFiles.length > 0 ? 0 : null)
    const abort = new AbortController()
    uploadAbortRef.current = abort
    try {
      const mediaKeys: string[] = []

      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i]
        const res = await mediaApi.upload(file, 'post', { visibility }, {
          signal: abort.signal,
          onProgress: pct => setUploadProgress(Math.round(((i + pct / 100) / mediaFiles.length) * 100)),
        })
        if (res.data.data?.key) mediaKeys.push(res.data.data.key)
      }

      const type = mediaFiles.length > 0 && mediaFiles[0].type.startsWith('video') ? 'video'
        : mediaFiles.length > 0 ? 'photo' : 'text'

      await postApi.create({
        type,
        content: postContent,
        media_keys: mediaKeys.length > 0 ? mediaKeys : undefined,
        visibility,
        comments_enabled: commentsEnabled,
        sharing_enabled: sharingEnabled,
        link_preview_dismissed: linkPreview.dismissed,
      })
      setPostContent('')
      setMediaFiles([])
      setMediaSizes([])
      linkPreview.reset()
      setCommentsEnabled(true)
      setSharingEnabled(true)
      setCreating(false)
      qc.resetQueries({ queryKey: ['feed'] })
      toast.success(t('composer.postPublishedToast'))
      hapticTap()
      if (user?.id) useCelebrationStore.getState().celebrate(user.id, 'first_post')
    } catch (err: any) {
      if (err?.code !== 'ERR_CANCELED') toast.error(t('composer.postFailedToast'))
    }
    finally { setPosting(false); setUploadProgress(null); uploadAbortRef.current = null }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort()
  }

  // SP-5-14: notifications moved out of this profile-area menu into a
  // persistent bell in the top nav (both desktop header and mobile top bar).
  const menuItems = [
    { icon: <UserRound size={18} aria-hidden />, label: t('nav.myProfile'), action: () => navigate(`/u/${user?.username}`), badge: 0 },
    { icon: <SettingsIcon size={18} aria-hidden />, label: t('nav.settings'),  action: () => navigate('/settings'), badge: 0 },
    { icon: <Bookmark size={18} aria-hidden />, label: t('nav.saved'),     action: () => navigate('/saved'), badge: 0 },
    { icon: <UsersRound size={18} aria-hidden />, label: t('nav.friends'),   action: () => navigate('/friends'), badge: 0 },
    { icon: <CalendarDays size={18} aria-hidden />, label: t('nav.events'),    action: () => navigate('/events/new'), badge: 0 },
  ]

  // SP-5-00: no solid background on this wrapper — ThemeBackdrop (mounted
  // once at App root, behind everything) needs to show through in the
  // space this shell's own chrome doesn't otherwise cover. Individual
  // pages' own cards/dense-surfaces keep their own opaque/translucent
  // backgrounds regardless.
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* SP-3-05: global incoming-call overlay — reachable from every
          authenticated screen, fed by the same single presence socket
          this shell already owns (see handlePresenceServerEvent above). */}
      <Suspense fallback={null}><IncomingCallOverlay /></Suspense>
      <PwaBanners />
      {welcomeMode && user && (
        <WelcomeExperience name={user.first_name} mode={welcomeMode} onDone={() => setWelcomeMode(null)} />
      )}

      {/* ══ DESKTOP TOP NAVBAR ══════════════════════════════════ */}
      <header className="desktop-header" style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--glass-border)',
        boxShadow: '0 1px 20px rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, height: 58 }}>
          {/* Logo */}
          <Link to="/" aria-label={t('nav.home')} style={{ marginRight: 20, flexShrink: 0, display: 'flex', alignItems: 'center', minHeight: 44 }}><Wordmark height={24} /></Link>

          {/* Nav links */}
          <nav style={{ display: 'flex', gap: 2, flex: 1 }}>
            {DESKTOP_NAV.map(({ to, key }) => (
              <NavLink key={to} to={to} end={to === '/'}
                style={({ isActive }) => ({
                  padding: '6px 14px', minHeight: 44, display: 'flex', alignItems: 'center', borderRadius: 99,
                  fontSize: 13.5, fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--link)' : 'var(--text3)',
                  background: isActive ? 'var(--brand-light)' : 'transparent',
                  textDecoration: 'none', transition: 'all 0.15s',
                  whiteSpace: 'nowrap', position: 'relative',
                })}>
                {t(key)}
                {to === '/chats' && totalUnreadChat > 0 && (
                  <span style={{
                    position: 'absolute', top: 0, right: 2,
                    background: 'var(--danger-fill)', color: '#fff',
                    borderRadius: 99, fontSize: 9, fontWeight: 700,
                    padding: '1px 4px', minWidth: 14, textAlign: 'center',
                    lineHeight: '14px', pointerEvents: 'none',
                  }}>
                    {totalUnreadChat > 99 ? '99+' : totalUnreadChat}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Right: Notifications + Create + User menu */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* SP-5-14: bell moved out of the profile-area menu into the persistent nav */}
            <NavLink to="/buzz"
              style={({ isActive }) => ({
                position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', minHeight: 44, borderRadius: 99,
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--link)' : 'var(--text3)',
                background: isActive ? 'var(--brand-light)' : 'transparent',
                textDecoration: 'none', transition: 'all 0.15s',
              })}>
              <Bell size={18} aria-hidden />{t('nav.buzz')}
              {totalUnreadNotif > 0 && (
                <span data-testid="buzz-badge" style={{ position: 'absolute', top: 2, right: 2, background: 'var(--danger-fill)', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700, padding: '1px 4px', minWidth: 14, textAlign: 'center', lineHeight: '14px', pointerEvents: 'none' }}>
                  {totalUnreadNotif > 99 ? '99+' : totalUnreadNotif}
                </span>
              )}
            </NavLink>
            <motion.button whileTap={PRESS_TAP} onClick={() => setCreating(true)} aria-label={t('nav.newPost')}
              style={{ minHeight: 44, padding: '7px 18px', borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Plus size={18} strokeWidth={2.5} aria-hidden />{t('nav.post')}
            </motion.button>

            {/* User dropdown */}
            <div ref={avatarBtnRef} style={{ position: 'relative' }}>
              <motion.button type="button" whileTap={PRESS_TAP} onClick={openDesktopMenu} aria-haspopup="menu" aria-expanded={showDesktopMenu}
                style={{ fontFamily: 'inherit', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 10px 5px 5px', borderRadius: 99, border: '1.5px solid var(--border)', background: showDesktopMenu ? 'var(--brand-light)' : 'var(--surface)', transition: 'all 0.15s' }}>
                <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={28} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.first_name}</span>
                <ChevronDown size={14} aria-hidden style={{ color: 'var(--text4)' }} />
              </motion.button>

              <AnimatePresence>
                {showDesktopMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                      background: 'var(--white)',
                      border: '1px solid var(--border)',
                      borderRadius: 16,
                      boxShadow: 'var(--shadow-lg)',
                      minWidth: 190, overflow: 'hidden', zIndex: 200,
                    }}>
                    {/* Profile header */}
                    <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={36} />
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{user?.first_name} {user?.last_name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text4)' }}>@{user?.username}</div>
                      </div>
                    </div>

                    {/* Menu items */}
                    {menuItems.map(item => (
                      <button key={item.label}
                        onClick={() => { item.action(); setShowDesktopMenu(false) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--text)', textAlign: 'left', fontWeight: 500, transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                        <span style={{ flex: 1 }}>{item.label}</span>
                        {item.badge > 0 && (
                          <span style={{ background: 'var(--danger-fill)', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        )}
                      </button>
                    ))}

                    <div style={{ borderTop: '1px solid var(--divider)' }}>
                      <button onClick={handleLogout}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--danger)', textAlign: 'left', fontWeight: 600 }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <LogOut size={18} aria-hidden />
                        {t('nav.signOut')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* ── MOBILE TOP BAR (logo, centred; bell in the unused left space) ── */}
      <div className="mobile-header" style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--glass-border)',
        padding: '6px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Inner wrapper owns position:relative so the bell can be absolutely
            positioned without touching the outer bar's own position:sticky. */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          {/* SP-5-14: bell moved out of the "You" sheet menu into the top bar
              itself — this bar previously only held the centred logo, so this
              adds zero crowding to the already-full 5-item bottom nav. */}
          <NavLink to="/buzz"
            style={({ isActive }) => ({
              position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, borderRadius: 12,
              background: isActive ? 'var(--brand-light)' : 'transparent',
              textDecoration: 'none',
            })}>
            <span style={{ position: 'relative', display: 'flex' }}>
              <Bell size={20} aria-hidden />
              {totalUnreadNotif > 0 && (
                <span data-testid="buzz-badge" style={{ position: 'absolute', top: -4, right: -8, background: 'var(--danger-fill)', color: '#fff', borderRadius: 99, fontSize: 8, fontWeight: 700, padding: '1px 3px', minWidth: 12, textAlign: 'center', lineHeight: '12px' }}>
                  {totalUnreadNotif > 99 ? '99+' : totalUnreadNotif}
                </span>
              )}
            </span>
            <span style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--text4)' }}>{t('nav.buzz')}</span>
          </NavLink>
          <Wordmark height={26} />
        </div>
      </div>

      {/* Main content */}
      <main className="main-content" style={{ flex: 1 }}>
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* SP-5-16: corporate attribution — desktop/web layouts only, hidden
          on mobile via the same .desktop-header-style media query (mobile
          already has a full bottom nav; no room for a footer there). */}
      <div className="desktop-footer">
        <Footer variant="app" />
      </div>

      {/* ══ MOBILE BOTTOM NAV ═══════════════════════════════════ */}
      <nav className="mobile-bottom-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid var(--glass-border)',
        display: 'flex', alignItems: 'stretch',
        zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom)',
        // SP-5-10: a fixed box (measured settled height 71.2px) so the web
        // font swapping in, or a badge appearing, can never resize/shift the
        // bar — it was the only layout shift on Home (CLS ≈ 0.09).
        height: 'calc(72px + env(safe-area-inset-bottom))', boxSizing: 'border-box', overflow: 'hidden',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.06)',
      }}>
        <MobileTab to="/"        icon={<House size={22} aria-hidden />} label={t('nav.home')}    end />
        {/* SP-5-07: Easy Mode simplifies the phone nav to Home / Chats /
            Profile. Explore stays reachable from Home's empty state, and
            posting from Home's own "What's on your mind" card. */}
        {!easyMode && <MobileTab to="/explore" icon={<Compass size={22} aria-hidden />} label={t('nav.explore')} />}

        {/* Centre + button */}
        {!easyMode && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 3, padding: '4px 0' }}>
          <motion.button
            whileTap={{ scale: 0.88, rotate: 45 }}
            onClick={() => setCreating(true)}
            aria-label={t('nav.newPost')}
            style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)',
              border: 'none', cursor: 'pointer',
              fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-brand)',
            }}>
            <Plus size={24} strokeWidth={2.5} aria-hidden />
          </motion.button>
          <span style={{ fontSize: 9.5, fontWeight: 500, color: 'var(--text4)' }}>{t('nav.post')}</span>
        </div>}

        <MobileTab to="/chats" icon={<MessageCircle size={22} aria-hidden />} label={t('nav.chats')} badge={totalUnreadChat} />

        {/* Profile tab — navigates to profile page */}
        {/* Same box as MobileTab (top-stacked 8px/3px gap, 22px glyph slot,
            inherited line-height) so the avatar and label line up with the
            icon tabs — a centred/min-height button sat off their rhythm. */}
        <button type="button" aria-expanded={showMobileSheet}
          style={{ ...MOBILE_TAB_BOX, cursor: 'pointer', position: 'relative', background: 'none', border: 'none', fontFamily: 'inherit', lineHeight: 'inherit', color: 'var(--text4)' }}
          onClick={() => setShowMobileSheet(!showMobileSheet)}>
          <div style={{ position: 'relative' }}>
            {/* SP-5-14: the notification badge that used to live here moved
                to the dedicated, labeled bell in the top bar — an unlabeled
                red dot on this avatar would now duplicate that count with
                no visible text explaining what it means. */}
            <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={MOBILE_TAB_GLYPH} />
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 500 }}>{easyMode ? t('nav.profile') : t('nav.you')}</span>
        </button>
      </nav>

      {/* Mobile "You" menu — slides up from bottom */}
      <AnimatePresence>
        {showMobileSheet && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowMobileSheet(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 80, backdropFilter: 'blur(4px)' }}>
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'var(--white)', borderRadius: '20px 20px 0 0',
                paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
                overflow: 'hidden',
              }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '12px auto 4px' }} />
              <div style={{ padding: '12px 20px 14px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={44} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{user?.first_name} {user?.last_name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text4)' }}>@{user?.username}</div>
                </div>
              </div>
              {menuItems.map(item => (
                <button key={item.label}
                  onClick={() => { item.action(); setShowMobileSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--text)', textAlign: 'left', fontWeight: 500 }}>
                  <span style={{ width: 26, display: 'flex', justifyContent: 'center', color: 'var(--text3)' }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge > 0 && (
                    <span style={{ background: 'var(--danger-fill)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 7px', minWidth: 20, textAlign: 'center' }}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--divider)', margin: '4px 0' }}>
                <button onClick={() => { handleLogout(); setShowMobileSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--danger)', textAlign: 'left', fontWeight: 600 }}>
                  <span style={{ width: 26, display: 'flex', justifyContent: 'center' }}><LogOut size={20} aria-hidden /></span>
                  {t('nav.signOut')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ CREATE POST MODAL — SP-5-19: reuses the SP-5-04 Overlay
          primitive (mobile bottom sheet, desktop centered dialog) instead
          of the old fixed alignItems:'flex-end' backdrop, which opened
          below the fold on tall desktop viewports. closeOnEscape is off
          while a post/upload is in flight — an in-progress upload is the
          "unsafe to Escape-close" case the primitive's own contract
          anticipates. ══ */}
      <Overlay
        open={creating}
        onClose={closeComposer}
        ariaLabel={t('post.createTitle')}
        closeOnEscape={!posting}
        maxWidth={620}
        testId="composer-modal"
      >
              <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 18, color: 'var(--text)', marginBottom: 14, paddingRight: 36 }}>
                {t('post.createTitle')}
              </div>

              {/* Visibility selector */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(['public','friends','private'] as const).map(v => (
                  <button key={v} onClick={() => setVisibility(v)}
                    aria-pressed={visibility === v}
                    style={{ minHeight: 44, padding: '4px 12px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: visibility === v ? 'var(--btn-primary-bg)' : 'var(--bg2)',
                      color: visibility === v ? 'var(--btn-primary-text)' : 'var(--text4)',
                      border: visibility === v ? 'none' : '1px solid var(--border)',
                      cursor: 'pointer' }}>
                    {v === 'public' ? <><Globe size={14} aria-hidden />{t('composer.visibilityPublic')}</> : v === 'friends' ? <><UsersRound size={14} aria-hidden />{t('nav.friends')}</> : <><Lock size={14} aria-hidden />{t('settings.privacyOnlyMe')}</>}
                  </button>
                ))}
              </div>

              {/* SP-2-19: creation-time controls, default ON */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text3)', cursor: 'pointer', minHeight: 44 }}>
                  <input type="checkbox" checked={commentsEnabled} onChange={e => setCommentsEnabled(e.target.checked)} />
                  {t('post.allowComments')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text3)', cursor: 'pointer', minHeight: 44 }}>
                  <input type="checkbox" checked={sharingEnabled} onChange={e => setSharingEnabled(e.target.checked)} />
                  {t('post.allowSharing')}
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={36} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  {/* SP-5-19: no autoFocus here — the textarea's own native
                      autofocus commits synchronously, before Overlay's own
                      useEffect can capture "what had focus before open" as
                      the trigger button, silently breaking close-time focus
                      return. Overlay already owns generic focus-entry. */}
                  <MentionInput
                    value={postContent}
                    onChange={setPostContent}
                    placeholder={t('composer.placeholder')}
                    rows={4}
                    maxLength={5000}
                  />
                  {!linkPreview.dismissed && (
                    <LinkPreviewCard
                      preview={linkPreview.preview}
                      loading={linkPreview.loading}
                      onRemove={linkPreview.dismiss}
                    />
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Hidden file input */}
                <input ref={fileInputRef} type="file" style={{ display: 'none' }}
                  accept="image/*" multiple
                  onChange={e => { const files = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; handleFilesPicked(files) }} />

                <button onClick={() => openFilePicker('image/*')}
                  disabled={compressing}
                  style={{ minHeight: 44, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: mediaFiles.length > 0 ? 'var(--btn-primary-bg)' : 'var(--brand-light)', color: mediaFiles.length > 0 ? 'var(--btn-primary-text)' : 'var(--link)', border: '1px solid var(--border)', cursor: compressing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: compressing ? 0.6 : 1 }}>
                  <ImageIcon size={16} aria-hidden />{compressing ? t('composer.processingEllipsis') : mediaFiles.length > 0 ? (mediaFiles.length > 1 ? t('composer.photoCountPlural', { count: String(mediaFiles.length) }) : t('composer.photoCountSingular', { count: String(mediaFiles.length) })) : t('composer.photoButton')}
                </button>
                <button onClick={() => openFilePicker(VIDEO_ACCEPT)}
                  disabled={compressing}
                  style={{ minHeight: 44, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: 'var(--brand-light)', color: 'var(--link)', border: '1px solid var(--border)', cursor: compressing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: compressing ? 0.6 : 1 }}>
                  <Video size={16} aria-hidden />{t('composer.videoButton')}
                </button>
                {!posting && (
                  <motion.button whileTap={PRESS_TAP}
                    onClick={handlePost}
                    disabled={!postContent.trim() || compressing}
                    style={{ marginLeft: 'auto', padding: '9px 26px', borderRadius: 99, fontSize: 14, fontWeight: 700, background: postContent.trim() ? 'var(--btn-primary-bg)' : 'var(--bg2)', color: postContent.trim() ? 'var(--btn-primary-text)' : 'var(--text4)', border: 'none', cursor: postContent.trim() ? 'pointer' : 'default', boxShadow: postContent.trim() ? 'var(--shadow-brand)' : 'none', transition: 'all 0.15s' }}>
                    {t('nav.post')}
                  </motion.button>
                )}
                {posting && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text4)' }}>
                      {uploadProgress !== null ? t('composer.uploadingPercent', { pct: String(uploadProgress) }) : t('composer.postingEllipsis')}
                    </span>
                    {uploadProgress !== null && (
                      <button onClick={cancelUpload}
                        style={{ padding: '5px 12px', minHeight: 44, borderRadius: 99, fontSize: 12, fontWeight: 600, background: 'var(--bg2)', color: 'var(--text3)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                        {t('chat.cancel')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* SP-2-15: shows the real before/after compression size once media is picked */}
              {mediaSizes.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 6 }}>
                  {formatBytes(mediaSizes.reduce((s, m) => s + m.original, 0))} → {formatBytes(mediaSizes.reduce((s, m) => s + m.compressed, 0))}
                </div>
              )}
      </Overlay>
      {/* Close desktop menu on outside click */}
    </div>
  )
}

// One box for every bottom-nav item, incl. the "You" avatar button.
const MOBILE_TAB_BOX: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0 4px' }
const MOBILE_TAB_GLYPH = 22 // icon size; the avatar uses the same slot

function MobileTab({ to, icon, label, end, badge }: { to: string; icon: React.ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink to={to} end={end} style={({ isActive }) => ({
      ...MOBILE_TAB_BOX, textDecoration: 'none',
      color: isActive ? 'var(--link)' : 'var(--text4)', transition: 'color 0.15s',
    })}>
      {({ isActive }) => (
        <>
          <div style={{ position: 'relative' }}>
            <motion.span animate={{ scale: isActive ? 1.12 : 1 }} transition={tabIndicatorTransition}
              style={{ display: 'flex' }}>{icon}</motion.span>
            {badge && badge > 0 ? (
              <span style={{ position: 'absolute', top: -4, right: -6, background: 'var(--danger-fill)', color: '#fff', borderRadius: 99, fontSize: 8, fontWeight: 700, padding: '1px 3px', minWidth: 14, textAlign: 'center', lineHeight: '14px' }}>
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </div>
          <span style={{ fontSize: 9.5, fontWeight: isActive ? 700 : 500 }}>{label}</span>
        </>
      )}
    </NavLink>
  )
}
