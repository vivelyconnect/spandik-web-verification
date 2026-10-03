// src/pages/Profile.tsx
import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { m as motion, AnimatePresence } from 'framer-motion'
import { userApi, postApi, mediaApi, api } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import Avatar from '../components/ui/Avatar'
import VerifiedBadge from '../components/ui/VerifiedBadge'
import { X, UserX, Ban, BellOff, Camera, Check, Ellipsis, FileText, Flag, Lock, MessageCircle, UserPlus, UsersRound } from 'lucide-react'
import PostCard from '../components/post/PostCard'
import ReportModal from '../components/ui/ReportModal'
import toast from 'react-hot-toast'
import { compressImage } from '../utils/mediaCompress'
import { classifyAvatarFile } from '../utils/avatarCrop'
import AvatarCropDialog from '../components/ui/AvatarCropDialog'
import { syncOwnProfileImageCaches, invalidateOtherOwnAvatarCaches } from '../utils/profileCache'
import { useT } from '../i18n/useT'
import { useDataSaverStore } from '../stores/dataSaverStore'
import { buildDelivery } from '../utils/mediaDelivery'
import type { StringKey } from '../i18n/strings'

const ALL_TABS = ['Posts', 'Media', 'Saved']
// ponytail: ALL_TABS stays English (used for tab-filtering logic below);
// this maps each to its display key so the label alone gets translated.
const TAB_LABEL_KEYS: Record<string, StringKey> = { Posts: 'profile.tabPosts', Media: 'profile.tabMedia', Saved: 'saved.title' }

export default function Profile() {
  const { username } = useParams<{ username: string }>()
  const navigate     = useNavigate()
  const qc           = useQueryClient()
  const authUser     = useAuthStore(s => s.user)
  const setUser      = useAuthStore(s => s.setUser)
  const isMe         = authUser?.username === username
  const t            = useT()
  const dataSaver    = useDataSaverStore(s => s.enabled)

  const [tab, setTab]         = useState(0)
  const TABS = isMe ? ALL_TABS : ALL_TABS.filter(t => t !== 'Saved')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ bio: '', tagline: '', first_name: '', last_name: '' })
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null) // SP-15-28

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef  = useRef<HTMLInputElement>(null)

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => userApi.get(username!).then(r => r.data.data),
    enabled: !!username,
  })

  const { data: userPosts } = useQuery({
    queryKey: ['userPosts', username],
    queryFn: () => api.get(`/posts/explore?username=${username}&limit=20`).then(r => r.data.data || []),
    enabled: !!username,
  })

  const { data: savedPosts } = useQuery({
    queryKey: ['savedPosts'],
    queryFn: () => postApi.saved().then(r => r.data.data || []),
    enabled: isMe && tab === 2,
  })

  const posts = tab === 2 && isMe
    ? savedPosts
    : tab === 1
    ? (userPosts || []).filter((p: any) => p.type === 'image' || p.type === 'video')
    : userPosts

  const followMutation = useMutation({
    mutationFn: () => userApi.follow(username!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', username] }),
  })

  // SP-4-03
  const blockMutation = useMutation({
    mutationFn: () => userApi.block(username!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['profile', username] })
      toast.success(res.data?.data?.blocked ? t('profile.blockedToast') : t('profile.unblockedToast'))
    },
    onError: () => toast.error(t('profile.blockStatusError')),
  })
  function handleBlockToggle() {
    setShowMoreMenu(false)
    const confirmMsg = profile?.is_blocked
      ? t('profile.unblockConfirm', { username: username! })
      : t('profile.blockConfirm', { username: username! })
    if (confirm(confirmMsg)) blockMutation.mutate()
  }

  // SP-11-02: unilateral, invisible-to-target viewer preference — distinct
  // from block (see handleBlockToggle above). Never mutates follow/friend
  // state, never notifies the target.
  const muteMutation = useMutation({
    mutationFn: () => (profile?.is_muted ? userApi.unmute(username!) : userApi.mute(username!)),
    onSuccess: () => {
      // SP-11-02 Section 23: mute/unmute must feel real immediately —
      // invalidate every content-list query the mute/keyword filter touches,
      // not just this profile.
      qc.invalidateQueries({ queryKey: ['profile', username] })
      qc.invalidateQueries({ queryKey: ['userPosts', username] })
      qc.invalidateQueries({ queryKey: ['feed'] })
      qc.invalidateQueries({ queryKey: ['explore'] })
      qc.invalidateQueries({ queryKey: ['stories'] })
      qc.invalidateQueries({ queryKey: ['suggestions'] })
      qc.invalidateQueries({ queryKey: ['saved'] })
      toast.success(profile?.is_muted ? t('profile.unmute') : t('profile.mute'))
    },
    onError: () => toast.error(t('profile.muteStatusError')),
  })
  function handleMuteToggle() {
    setShowMoreMenu(false)
    const confirmMsg = profile?.is_muted
      ? t('profile.unmuteConfirm', { username: username! })
      : t('profile.muteConfirm', { username: username! })
    if (confirm(confirmMsg)) muteMutation.mutate()
  }

  // SP-5-17: a refused/failed friend action used to fail silently (no
  // onError) — now it says so and refetches the real relationship state.
  const friendActionFailed = () => {
    qc.invalidateQueries({ queryKey: ['profile', username] })
    toast.error(t('friends.actionError'))
  }

  const friendReqMutation = useMutation({
    mutationFn: () => userApi.friendRequest(username!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile', username] }); toast.success(t('friends.sentToast')) },
    onError: friendActionFailed,
  })

  const acceptFRMutation = useMutation({
    mutationFn: () => userApi.acceptFR(profile?.friend_request_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', username] })
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      toast.success(t('friends.acceptedToast'))
    },
    onError: friendActionFailed,
  })

  // SP-5-17: unfriend (friends) or cancel own pending request (sent) — one
  // endpoint, DELETE /users/:username/friend.
  const unfriendMutation = useMutation({
    mutationFn: () => userApi.unfriend(username!),
    onSuccess: () => {
      const wasFriend = profile?.friend_request_status === 'friends'
      qc.invalidateQueries({ queryKey: ['profile', username] })
      qc.invalidateQueries({ queryKey: ['friends'] })
      toast.success(t(wasFriend ? 'friends.unfriendedToast' : 'friends.cancelledToast'))
    },
    onError: friendActionFailed,
  })
  function handleRemoveFriendship() {
    const name = profile?.first_name || username!
    const msg = profile?.friend_request_status === 'friends'
      ? t('friends.unfriendConfirm', { name })
      : t('friends.cancelConfirm', { name })
    if (confirm(msg)) unfriendMutation.mutate()
  }

  const updateMutation = useMutation({
    mutationFn: (data: any) => userApi.update(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', username] })
      setEditing(false)
      toast.success(t('profile.updatedToast'))
    },
    onError: () => toast.error(t('profile.updateFailedToast')),
  })

  // SP-15-28: final step shared by both the crop dialog's output and the
  // GIF-passthrough path below — uploads an already-final file, then uses
  // the fresh GET /users/me as the sole source of truth for both the
  // auth-store avatar (synchronous, pre-existing) and every other
  // currently-visible own-avatar surface (synchronous cache patch, fixing
  // the reported stale-header defect — never a fabricated URL).
  async function finishAvatarUpload(fileToUpload: File) {
    setUploading('avatar')
    try {
      const res = await mediaApi.upload(fileToUpload, 'profile')
      const key = res.data.data.key
      await userApi.update({ profile_pic_key: key })
      const freshUser = await userApi.me()
      setUser(freshUser.data.data)
      syncOwnProfileImageCaches(qc, freshUser.data.data)
      invalidateOtherOwnAvatarCaches(qc)
      toast.success(t('profile.avatarUpdatedToast'))
    } catch (err: any) { toast.error(err?.message || t('profile.uploadFailedToast')) }
    finally { setUploading(null) }
  }

  async function handleAvatarFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast.error(t('profile.max10mb')); return }

    const rejection = classifyAvatarFile(file)
    if (rejection?.kind === 'heic') {
      toast.error(t('profile.avatarHeicUnsupported'))
      return
    }
    if (rejection?.kind === 'gif') {
      // Existing SP-2-15 passthrough — animated GIFs are never sent through
      // the crop dialog (canvas export would flatten the animation).
      try {
        setUploading('avatar')
        const { file: compressed } = await compressImage(file)
        await finishAvatarUpload(compressed)
      } catch (err: any) { toast.error(err?.message || t('profile.uploadFailedToast')); setUploading(null) }
      return
    }
    setCropFile(file) // opens AvatarCropDialog
  }

  async function handleAvatarCropped(cropped: File) {
    setCropFile(null)
    await finishAvatarUpload(cropped)
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast.error(t('profile.max10mb')); e.target.value = ''; return }
    setUploading('cover')
    try {
      const { file: compressed } = await compressImage(file)
      const res = await mediaApi.upload(compressed, 'cover')
      const key = res.data.data.key
      await userApi.update({ cover_pic_key: key })
      const freshUser = await userApi.me()
      setUser(freshUser.data.data)
      qc.invalidateQueries({ queryKey: ['profile', username] })
      toast.success(t('profile.coverUpdatedToast'))
    } catch (err: any) { toast.error(err?.message || t('profile.uploadFailedToast')) }
    finally { setUploading(null); e.target.value = '' }
  }

  async function startMessage() {
    try {
      const res = await api.post('/chat/threads', { user_id: profile.id })
      const threadId = res.data.data.thread_id
      navigate(`/chats/${threadId}`)
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('profile.cannotMessage'))
    }
  }

  function startEdit() {
    setEditForm({
      bio: profile?.bio || '',
      tagline: profile?.tagline || '',
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
    })
    setEditing(true)
  }

  if (isLoading) return <ProfileSkeleton />
  if (!profile) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <UserX size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--text4)' }} />
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>{t('profile.userNotFound')}</div>
      <button onClick={() => navigate('/')}
        style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
        {t('notFound.goHome')}
      </button>
    </div>
  )

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
      {/* Hidden file inputs */}
      <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarFileSelected} />
      {cropFile && (
        <AvatarCropDialog file={cropFile} onCancel={() => setCropFile(null)} onCropped={handleAvatarCropped} />
      )}
      <input ref={coverInputRef}  type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload} />

      {/* Cover photo */}
      <div
        onClick={() => isMe && coverInputRef.current?.click()}
        onMouseEnter={e => { if (isMe) (e.currentTarget.querySelector('.cover-overlay') as HTMLElement)!.style.opacity = '1' }}
        onMouseLeave={e => { if (isMe) (e.currentTarget.querySelector('.cover-overlay') as HTMLElement)!.style.opacity = '0' }}
        style={{ position: 'relative', height: 200, background: 'linear-gradient(135deg, var(--brand), var(--accent))', overflow: 'hidden', cursor: isMe ? 'pointer' : 'default' }}>
        {profile.cover_pic_url && (() => {
          const coverDelivery = buildDelivery(profile.cover_pic_url, 960, dataSaver)
          return <img src={coverDelivery.src} srcSet={coverDelivery.srcSet || undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        })()}
        {isMe && (
          <div className="cover-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
            <div style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
              {uploading === 'cover' ? t('profile.uploadingEllipsis') : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Camera size={16} aria-hidden />{t('profile.changeCoverPhoto')}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Profile header */}
      <div style={{ padding: '0 20px', background: 'var(--white)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: -44, marginBottom: 16 }}>
          {/* Avatar with upload — SP-5-08: the owner's edit trigger is a
              real <button> (keyboard/Enter/Space, accessible name, visible
              focus) instead of a click-only div; everyone else gets a plain,
              non-interactive avatar. Crop/upload flow itself is unchanged. */}
          {isMe ? (
            <button type="button" data-testid="profile-header-avatar"
              aria-label={t('avatar.changePhoto')} aria-busy={uploading === 'avatar'}
              onClick={() => avatarInputRef.current?.click()}
              onMouseEnter={e => { const o = e.currentTarget.querySelector('.avatar-overlay') as HTMLElement; if (o) o.style.opacity = '1' }}
              onMouseLeave={e => { const o = e.currentTarget.querySelector('.avatar-overlay') as HTMLElement; if (o && uploading !== 'avatar') o.style.opacity = '0' }}
              style={{ position: 'relative', flexShrink: 0, cursor: 'pointer', padding: 0, border: 'none', background: 'none', borderRadius: '50%', font: 'inherit' }}>
              <Avatar src={profile.profile_pic_url} name={profile.first_name} size="hero" style={{ boxShadow: '0 0 0 4px var(--white)', background: 'var(--bg2)' }} />
              {/* Hover overlay for mouse users */}
              <div className="avatar-overlay" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: uploading === 'avatar' ? 1 : 0, transition: 'opacity 0.2s', color: '#fff' }}>
                <Camera size={22} aria-hidden />
              </div>
              {/* Always-visible badge so touch users (no hover) can discover this is tappable */}
              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 30, height: 30, borderRadius: '50%', background: 'var(--white)', border: '2px solid var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', boxShadow: 'var(--shadow-sm)' }}>
                <Camera size={16} aria-hidden />
              </div>
            </button>
          ) : (
            <div data-testid="profile-header-avatar" style={{ position: 'relative', flexShrink: 0, borderRadius: '50%' }}>
              <Avatar src={profile.profile_pic_url} name={profile.first_name} size="hero" style={{ boxShadow: '0 0 0 4px var(--white)', background: 'var(--bg2)' }} />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, paddingBottom: 4 }}>
            {isMe ? (
              <button onClick={startEdit}
                style={{ padding: '8px 20px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                {t('profile.editProfile')}
              </button>
            ) : (
              <>
                {/* Friend request button */}
                {profile.friend_request_status === 'friends' ? (
                  <button type="button" data-testid="profile-relationship" onClick={handleRemoveFriendship} disabled={unfriendMutation.isPending}
                    aria-haspopup="dialog" title={t('friends.unfriend')}
                    style={{ padding: '8px 16px', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--bg2)', color: 'var(--link)', border: '1px solid var(--brand)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <UsersRound size={16} aria-hidden />{t('nav.friends')}
                  </button>
                ) : profile.friend_request_status === 'sent' ? (
                  <button type="button" data-testid="profile-relationship" onClick={handleRemoveFriendship} disabled={unfriendMutation.isPending}
                    aria-haspopup="dialog" title={t('friends.cancelRequest')}
                    style={{ padding: '8px 16px', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text3)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Check size={16} aria-hidden />{t('friends.requestSent')}
                  </button>
                ) : profile.friend_request_status === 'received' ? (
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => acceptFRMutation.mutate()}
                    style={{ padding: '8px 16px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                    {t('friends.acceptRequest')}
                  </motion.button>
                ) : profile.can_send_friend_request === false ? (
                  // SP-11-03 Section 48: never show an action that looks
                  // available and only fails after click — a disabled
                  // state with a clear reason instead.
                  <div title={t('profile.friendRequestRestricted')}
                    style={{ padding: '8px 16px', minHeight: 44, display: 'flex', alignItems: 'center', borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text4)', border: '1px solid var(--border)', cursor: 'default' }}>
                    {t('profile.friendRequestRestricted')}
                  </div>
                ) : (
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => friendReqMutation.mutate()}
                    style={{ padding: '8px 16px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                    <UserPlus size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('friends.addFriend')}
                  </motion.button>
                )}
                {/* Follow button */}
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => followMutation.mutate()}
                  style={{ padding: '8px 16px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: profile.is_following ? 'var(--bg2)' : 'transparent', color: profile.is_following ? 'var(--text3)' : 'var(--link)', border: `1px solid ${profile.is_following ? 'var(--border)' : 'var(--brand)'}`, cursor: 'pointer' }}>
                  {profile.is_following ? t('follow.following') : t('follow.follow')}
                </motion.button>
                {/* Message button */}
                <button onClick={startMessage}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                  <MessageCircle size={16} aria-hidden />{t('profile.message')}
                </button>
                {/* More menu — report + block/unblock */}
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setShowMoreMenu(!showMoreMenu)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', minHeight: 44, borderRadius: 99, background: 'var(--bg2)', color: 'var(--text4)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                    <Ellipsis size={16} aria-hidden />{t('post.more')}
                  </button>
                  <AnimatePresence>
                    {showMoreMenu && (
                      <motion.div initial={{ opacity: 0, scale: 0.9, y: -5 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
                        style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', minWidth: 160, overflow: 'hidden' }}>
                        <button onClick={() => { setShowReport(true); setShowMoreMenu(false) }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
                          <Flag size={16} aria-hidden />{t('post.report')}
                        </button>
                        <button onClick={handleMuteToggle}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
                          <BellOff size={16} aria-hidden />{profile.is_muted ? t('profile.unmute') : t('profile.mute')}
                        </button>
                        <button onClick={handleBlockToggle}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: 'var(--danger)', textAlign: 'left' }}>
                          <Ban size={16} aria-hidden />{profile.is_blocked ? t('profile.unblock') : t('profile.block')}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {showMoreMenu && <div onClick={() => setShowMoreMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 15 }} />}
                </div>
              </>
            )}
          </div>
        </div>
        {showReport && <ReportModal targetType="user" targetId={profile.id} onClose={() => setShowReport(false)} />}

        {/* Name + bio */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>{profile.first_name} {profile.last_name}</span>
            {!isMe && profile.is_following_you && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text4)', background: 'var(--bg2)', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border)' }}>{t('profile.followsYou')}</span>
            )}
            <VerifiedBadge verified={profile.is_verified_badge} size={18} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text4)', marginBottom: 6 }}>@{profile.username}</div>
          {profile.tagline && <div style={{ fontSize: 13, color: 'var(--link)', fontWeight: 600, marginBottom: 6, overflowWrap: 'anywhere' }}>{profile.tagline}</div>}
          {profile.bio && <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, maxWidth: 480, overflowWrap: 'anywhere' }}>{profile.bio}</div>}
        </div>

        {/* Stats — SP-11-03 Section 46/48: counts always show (list
            visibility is narrower than count visibility); a viewer who
            can't view the LIST gets a clear private state instead of
            navigating into an apparently broken/empty page. */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
          {[
            { label: t('profile.tabPosts'),       value: profile.post_count || 0 },
            { label: t('follow.followersTitle'), value: profile.follower_count || 0, action: () => navigate(`/u/${username}/followers`), locked: profile.can_view_followers === false },
            { label: t('follow.followingTitle'), value: profile.following_count || 0, action: () => navigate(`/u/${username}/following`), locked: profile.can_view_following === false },
          ].map(stat => (
            // SP-5-15: a real button when it navigates (was a click-only div);
            // a locked list is a plain, clearly-labelled non-control.
            (stat as any).action && !(stat as any).locked ? (
              <button key={stat.label} type="button" onClick={(stat as any).action}
                style={{ cursor: 'pointer', textAlign: 'center', background: 'none', border: 'none', padding: '0 4px', minHeight: 44, fontFamily: 'inherit' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{formatCount(stat.value)}</div>
                <div style={{ fontSize: 12, color: 'var(--text4)' }}>{stat.label}</div>
              </button>
            ) : (
              <div key={stat.label} title={(stat as any).locked ? t('profile.followListPrivate') : undefined}
                style={{ textAlign: 'center', opacity: (stat as any).locked ? 0.55 : 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{formatCount(stat.value)}</div>
                <div style={{ fontSize: 12, color: 'var(--text4)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{stat.label}{(stat as any).locked && <Lock size={11} aria-label={t('profile.followListPrivate')} />}</div>
              </div>
            )
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderTop: '1px solid var(--divider)' }}>
          {TABS.map((tabName, i) => (
            <button key={tabName} onClick={() => setTab(i)} aria-pressed={tab === i}
              style={{ flex: 1, minHeight: 44, padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === i ? 700 : 500, color: tab === i ? 'var(--link)' : 'var(--text4)', borderBottom: tab === i ? '2px solid var(--brand)' : '2px solid transparent', transition: 'all 0.15s' }}>
              {t(TAB_LABEL_KEYS[tabName])}
            </button>
          ))}
        </div>
      </div>

      {/* Posts */}
      <div style={{ padding: '16px' }}>
        {posts?.map((post: any) => <PostCard key={post.id} post={post} />)}
        {(!posts || posts.length === 0) && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text4)' }}>
            <FileText size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--text4)' }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: isMe ? 16 : 0 }}>{t('profile.noPostsYet')}</div>
            {isMe && (
              <button onClick={() => navigate('/')}
                style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                {t('profile.shareFirstPost')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setEditing(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--white)', borderRadius: 20, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: '28px 24px', maxWidth: 460, width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 20, color: 'var(--text)' }}>{t('profile.editProfile')}</span>
                <button onClick={() => setEditing(false)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', fontSize: 13, fontWeight: 600, minWidth: 44, minHeight: 44, cursor: 'pointer', color: 'var(--text4)' }}><X size={16} aria-hidden />{t('overlay.close')}</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[['first_name', t('auth.firstName')], ['last_name', t('auth.lastName')]].map(([f, l]) => (
                    <div key={f}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 5 }}>{l}</label>
                      <input value={(editForm as any)[f]} onChange={e => setEditForm(p => ({ ...p, [f]: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                  ))}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 5 }}>{t('profile.tagline')} <span style={{ fontWeight: 400, color: 'var(--text4)' }}>{t('profile.max30')}</span></label>
                  <input value={editForm.tagline} maxLength={30} onChange={e => setEditForm(p => ({ ...p, tagline: e.target.value }))}
                    placeholder={t('profile.taglinePlaceholder')} style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 5 }}>{t('profile.bio')} <span style={{ fontWeight: 400, color: 'var(--text4)' }}>{t('profile.max200')}</span></label>
                  <textarea value={editForm.bio} maxLength={200} rows={3} onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))}
                    placeholder={t('profile.bioPlaceholder')}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 9, fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', resize: 'none', lineHeight: 1.5 }} />
                  <div style={{ fontSize: 11, color: 'var(--text4)', textAlign: 'right', marginTop: 2 }}>{editForm.bio.length}/200</div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>{t('share.cancel')}</button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending}
                    style={{ flex: 2, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                    {updateMutation.isPending ? t('profile.savingEllipsis') : t('profile.saveChanges')}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n/1000).toFixed(1)}K`
  return String(n)
}

function ProfileSkeleton() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="skeleton-bone" style={{ height: 200 }} />
      <div style={{ padding: '0 20px', background: 'var(--white)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginTop: -44, marginBottom: 16 }}>
          <div className="skeleton-bone" style={{ width: 90, height: 90, borderRadius: '50%', border: '4px solid var(--white)' }} />
        </div>
        <div className="skeleton-bone" style={{ height: 20, width: '30%', borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-bone" style={{ height: 14, width: '20%', borderRadius: 6, marginBottom: 16 }} />
      </div>
    </div>
  )
}
