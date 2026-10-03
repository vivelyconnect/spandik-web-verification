// src/pages/FollowList.tsx — SP-15-26: /u/:username/followers and
// /u/:username/following. The backend routes and the userApi.followers()/
// following() client helpers already existed (see api/src/routes/users.ts)
// — the real defect was that no frontend route or page ever consumed them,
// so Profile.tsx's own "Followers"/"Following" stat buttons navigated to a
// route the router never registered, landing on NotFound. One shared
// component for both (registered under both routes in App.tsx) since the
// list rendering, states and follow action are otherwise identical.
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, TriangleAlert, UsersRound } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userApi } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import Avatar from '../components/ui/Avatar'
import VerifiedBadge from '../components/ui/VerifiedBadge'
import { useT } from '../i18n/useT'
import toast from 'react-hot-toast'

export default function FollowList() {
  const { username } = useParams<{ username: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const currentUser = useAuthStore(s => s.user)
  const mode: 'followers' | 'following' = location.pathname.endsWith('/following') ? 'following' : 'followers'

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['follow-list', mode, username],
    queryFn: () => (mode === 'followers' ? userApi.followers(username!) : userApi.following(username!)).then(r => r.data.data || []),
    enabled: !!username,
  })
  // SP-11-03 Section 45/48: a 403 here means the owner's privacy setting
  // disallows this viewer — a distinct, clear state, never an
  // apparently-broken generic error (and no point offering Retry, which
  // would just 403 again).
  const isPrivate = (error as any)?.response?.status === 403

  const followMutation = useMutation({
    mutationFn: (target: string) => userApi.follow(target),
    onSuccess: (_res, target) => {
      qc.setQueryData<any[]>(['follow-list', mode, username], prev =>
        prev?.map(u => (u.username === target ? { ...u, is_following: !u.is_following } : u)))
    },
    onError: () => toast.error(t('follow.actionFailed')),
  })

  const title = mode === 'followers' ? t('follow.followersTitle') : t('follow.followingTitle')

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--white)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 5 }}>
        <button onClick={() => navigate(`/u/${username}`)} aria-label={t('chat.back')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text3)', minHeight: 44, minWidth: 44, flexShrink: 0 }}>
          <ArrowLeft size={20} aria-hidden />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{username}</div>
        </div>
      </div>

      {isLoading && (
        <div style={{ padding: '4px 16px' }}>
          {[1, 2, 3, 4, 5].map(i => <RowSkeleton key={i} />)}
        </div>
      )}

      {!isLoading && isError && isPrivate && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Lock size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--text4)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('profile.followListPrivate')}</div>
        </div>
      )}

      {!isLoading && isError && !isPrivate && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <TriangleAlert size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--text4)' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{t('follow.errorTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--text4)', marginBottom: 16 }}>{t('follow.errorBody')}</div>
          <button onClick={() => refetch()}
            style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            {t('follow.retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <UsersRound size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--text4)' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'followers' ? t('follow.emptyFollowers') : t('follow.emptyFollowing')}
          </div>
        </div>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div>
          {data.map((u: any) => {
            const isSelf = !!currentUser && u.id === currentUser.id
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--divider)' }}>
                <button type="button" aria-label={t('avatar.viewProfile', { name: `${u.first_name} ${u.last_name}` })} onClick={() => navigate(`/u/${u.username}`)} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textAlign: 'left', color: 'inherit', cursor: 'pointer', flexShrink: 0, borderRadius: '50%' }}>
                  <Avatar src={u.profile_pic_url} name={u.first_name} size={48} />
                </button>
                <button type="button" onClick={() => navigate(`/u/${u.username}`)} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textAlign: 'left', color: 'inherit', flex: 1, minWidth: 0, cursor: 'pointer', minHeight: 44 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.first_name} {u.last_name}
                    <VerifiedBadge verified={u.is_verified_badge} size={15} />
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text4)' }}>@{u.username}</div>
                  {u.tagline && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.tagline}</div>
                  )}
                </button>
                {!isSelf && (
                  <button onClick={() => followMutation.mutate(u.username)} aria-label={u.is_following ? t('follow.following') : t('follow.follow')}
                    style={{ padding: '8px 16px', minHeight: 44, borderRadius: 99, fontSize: 12.5, fontWeight: 700, background: u.is_following ? 'var(--bg2)' : 'var(--btn-primary-bg)', color: u.is_following ? 'var(--text3)' : 'var(--btn-primary-text)', border: u.is_following ? '1px solid var(--border)' : 'none', cursor: 'pointer', flexShrink: 0 }}>
                    {u.is_following ? t('follow.following') : t('follow.follow')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0' }}>
      <div className="skeleton-bone" style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton-bone" style={{ height: 13, width: '40%', borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-bone" style={{ height: 11, width: '30%', borderRadius: 6 }} />
      </div>
    </div>
  )
}
