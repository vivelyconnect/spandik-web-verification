// src/pages/Friends.tsx
//
// SP-5-20: compact, human-first people rows (was bulky profile-card tiles
// with fake gradient "cover" strips). Visual/state UX only — same API
// calls, same authorization/ranking/privacy semantics, no extra per-row
// requests. Avatar + VerifiedBadge are the shared SP-5-08 primitives.
// SP-5-17: adds the "Your Friends" tab (own accepted friends + Unfriend).
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { m as motion, AnimatePresence } from 'framer-motion'
import { userApi } from '../utils/api'
import Avatar from '../components/ui/Avatar'
import VerifiedBadge from '../components/ui/VerifiedBadge'
import toast from 'react-hot-toast'
import { hapticTap } from '../motion/haptics'
import { listContainerVariants, listItemVariants } from '../motion/presets'
import { useCelebrationStore } from '../stores/celebrationStore'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../i18n/useT'

// Truthful per-suggestion request state. 'sent' comes only from the server:
// a 2xx, or a 409 "Request already sent" (a pending request already exists).
type RequestState = 'sending' | 'sent' | 'restricted'

// Pure: maps a failed friend-request POST to what the server actually said.
export function requestStateFromError(status: number | undefined, message: string | undefined): RequestState | null {
  if (status === 409 && /already sent/i.test(message || '')) return 'sent'
  if (status === 403) return 'restricted'
  return null
}

const GRID: React.CSSProperties = {
  listStyle: 'none', display: 'grid', gap: 8,
  // One column on phones, two compact columns from ~tablet up — no media
  // query needed, and never a stretched single phone row on desktop.
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))',
}

const ROW: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px',
  background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 14,
  padding: '10px 12px', boxShadow: 'var(--shadow-sm)', minWidth: 0,
}

const BTN_PRIMARY: React.CSSProperties = {
  minHeight: 44, padding: '0 12px', borderRadius: 99, fontSize: 13, fontWeight: 700,
  background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none',
  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
}

const BTN_SECONDARY: React.CSSProperties = {
  minHeight: 44, padding: '0 12px', borderRadius: 99, fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)',
  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
}

const BTN_DONE: React.CSSProperties = {
  ...BTN_SECONDARY, background: 'var(--bg2)', color: 'var(--text3)', cursor: 'default',
}

export default function Friends() {
  const t = useT()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [tab, setTab] = useState<'requests' | 'friends' | 'suggestions'>('requests')
  const [busyRequests, setBusyRequests] = useState<Set<string>>(new Set())
  const [requestStates, setRequestStates] = useState<Record<string, RequestState>>({})
  const [followStates, setFollowStates] = useState<Record<string, 'following' | 'pending'>>({})

  const requestsQ = useQuery({
    queryKey: ['friend-requests'],
    queryFn: () => userApi.friendRequests().then(r => r.data.data || []),
  })

  // SP-5-17: the viewer's own accepted friends (GET /users/me/friends) —
  // fetched only once that tab is opened, so the page's first load stays
  // at the same request count as before.
  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: () => userApi.friends().then(r => r.data.data || []),
    enabled: tab === 'friends',
  })

  const suggestionsQ = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => userApi.suggestions().then(r => r.data.data || []),
  })

  function setBusy(id: string, on: boolean) {
    setBusyRequests(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  }

  // Every Friends action also invalidates that person's cached profile
  // (global staleTime is 2 min) so /u/:username never shows a stale
  // "Accept Request"/"Add Friend" state right after acting here.
  const invalidateProfile = (username: string) => qc.invalidateQueries({ queryKey: ['profile', username] })

  const acceptMutation = useMutation({
    mutationFn: ({ id }: { id: string; username: string }) => userApi.acceptFR(id),
    onMutate: ({ id }) => setBusy(id, true),
    onSuccess: (_d, { username }) => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      qc.invalidateQueries({ queryKey: ['friends'] })
      invalidateProfile(username)
      toast.success(t('friends.acceptedToast'))
      hapticTap()
      // SP-5-02 remediation: account-scoped, server-truth-informed — unchanged.
      if (user?.id) useCelebrationStore.getState().celebrate(user.id, 'first_friend')
    },
    onError: () => toast.error(t('friends.actionError')),
    onSettled: (_d, _e, { id }) => setBusy(id, false),
  })

  const declineMutation = useMutation({
    mutationFn: ({ id }: { id: string; username: string }) => userApi.declineFR(id),
    onMutate: ({ id }) => setBusy(id, true),
    onSuccess: (_d, { username }) => { qc.invalidateQueries({ queryKey: ['friend-requests'] }); invalidateProfile(username) },
    onError: () => toast.error(t('friends.actionError')),
    onSettled: (_d, _e, { id }) => setBusy(id, false),
  })

  const unfriendMutation = useMutation({
    mutationFn: (username: string) => userApi.unfriend(username),
    onMutate: (username) => setBusy(`friend:${username}`, true),
    onSuccess: (_d, username) => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['suggestions'] })
      invalidateProfile(username)
      toast.success(t('friends.unfriendedToast'))
    },
    onError: () => toast.error(t('friends.actionError')),
    onSettled: (_d, _e, username) => setBusy(`friend:${username}`, false),
  })
  function handleUnfriend(person: any) {
    const name = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.username
    if (confirm(t('friends.unfriendConfirm', { name }))) unfriendMutation.mutate(person.username)
  }

  const followMutation = useMutation({
    mutationFn: (username: string) => userApi.follow(username),
    onMutate: (username) => setFollowStates(s => ({ ...s, [username]: 'pending' })),
    onSuccess: (res, username) => {
      // POST /follow is a server-side TOGGLE — the response says which way
      // it went, so the button reflects that instead of assuming.
      const following = !!res.data?.data?.following
      setFollowStates(s => { const n = { ...s }; if (following) n[username] = 'following'; else delete n[username]; return n })
      invalidateProfile(username)
      if (following) toast.success(t('friends.followedToast', { username }))
    },
    onError: (_e, username) => {
      setFollowStates(s => { const n = { ...s }; delete n[username]; return n })
      toast.error(t('friends.actionError'))
    },
  })

  const friendReqMutation = useMutation({
    mutationFn: (username: string) => userApi.friendRequest(username),
    onMutate: (username) => setRequestStates(s => ({ ...s, [username]: 'sending' })),
    onSuccess: (_, username) => {
      setRequestStates(s => ({ ...s, [username]: 'sent' }))
      invalidateProfile(username)
      toast.success(t('friends.sentToast'))
    },
    onError: (err: any, username) => {
      const next = requestStateFromError(err?.response?.status, err?.response?.data?.error)
      setRequestStates(s => { const n = { ...s }; if (next) n[username] = next; else delete n[username]; return n })
      if (!next) toast.error(t('friends.actionError'))
    },
  })

  const requests: any[] = requestsQ.data || []
  const friends: any[] = friendsQ.data || []
  const suggestions: any[] = suggestionsQ.data || []
  const pendingCount = requests.length

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px' }}>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 900, color: 'var(--text)', marginBottom: 2 }}>{t('nav.friends')}</h1>
      <p style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 16 }}>{t('friends.subtitle')}</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--divider)' }}>
        {([
          { id: 'requests', label: t('friends.tabRequests'), count: pendingCount },
          { id: 'friends', label: t('friends.tabFriends'), count: 0 },
          { id: 'suggestions', label: t('friends.tabSuggestions'), count: 0 },
        ] as const).map(tb => (
          <button key={tb.id} type="button" onClick={() => setTab(tb.id)} aria-pressed={tab === tb.id}
            style={{ minHeight: 44, padding: '0 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: tab === tb.id ? 700 : 500, color: tab === tb.id ? 'var(--link)' : 'var(--text3)', borderBottom: tab === tb.id ? '2px solid var(--brand)' : '2px solid transparent', marginBottom: -2, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.25, textAlign: 'left', minWidth: 0 }}>
            {tb.label}
            {tb.count > 0 && (
              <span style={{ background: 'var(--brand-light)', color: 'var(--link)', borderRadius: 99, fontSize: 12, fontWeight: 700, minWidth: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{tb.count}</span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'requests' && (
          <motion.section key="requests" data-testid="friends-requests" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {requestsQ.isLoading ? <RowsSkeleton /> : requestsQ.isError ? (
              <ErrorState onRetry={() => requestsQ.refetch()} />
            ) : requests.length === 0 ? (
              <EmptyState title={t('friends.requestsEmptyTitle')} body={t('friends.requestsEmptyBody')}
                action={<button type="button" onClick={() => setTab('suggestions')} style={BTN_PRIMARY}>{t('friends.findPeople')}</button>} />
            ) : (
              <motion.ul initial="hidden" animate="show" variants={listContainerVariants} style={GRID}>
                {requests.map((r: any) => {
                  const busy = busyRequests.has(r.id)
                  const accepting = busy && acceptMutation.isPending && acceptMutation.variables?.id === r.id
                  return (
                    <PersonRow key={r.id} person={r} context={`@${r.username}`}>
                      {nameId => (
                        <>
                          <button type="button" onClick={() => acceptMutation.mutate({ id: r.id, username: r.username })} disabled={busy}
                            aria-describedby={nameId} aria-busy={accepting}
                            style={{ ...BTN_PRIMARY, opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}>
                            {accepting ? t('friends.accepting') : t('friends.accept')}
                          </button>
                          <button type="button" onClick={() => declineMutation.mutate({ id: r.id, username: r.username })} disabled={busy}
                            aria-describedby={nameId}
                            style={{ ...BTN_SECONDARY, opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}>
                            {t('friends.decline')}
                          </button>
                        </>
                      )}
                    </PersonRow>
                  )
                })}
              </motion.ul>
            )}
          </motion.section>
        )}

        {tab === 'friends' && (
          <motion.section key="friends" data-testid="friends-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {friendsQ.isLoading ? <RowsSkeleton /> : friendsQ.isError ? (
              <ErrorState onRetry={() => friendsQ.refetch()} />
            ) : friends.length === 0 ? (
              <EmptyState title={t('friends.friendsEmptyTitle')} body={t('friends.friendsEmptyBody')}
                action={<button type="button" onClick={() => setTab('suggestions')} style={BTN_PRIMARY}>{t('friends.findPeople')}</button>} />
            ) : (
              <motion.ul initial="hidden" animate="show" variants={listContainerVariants} style={GRID}>
                {friends.map((f: any) => {
                  const busy = busyRequests.has(`friend:${f.username}`)
                  return (
                    <PersonRow key={f.id} person={f} context={f.tagline ? `@${f.username} · ${f.tagline}` : `@${f.username}`}>
                      {nameId => (
                        <button type="button" onClick={() => handleUnfriend(f)} disabled={busy} aria-describedby={nameId}
                          style={{ ...BTN_SECONDARY, opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}>
                          {t('friends.unfriend')}
                        </button>
                      )}
                    </PersonRow>
                  )
                })}
              </motion.ul>
            )}
          </motion.section>
        )}

        {tab === 'suggestions' && (
          <motion.section key="suggestions" data-testid="friends-suggestions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {suggestionsQ.isLoading ? <RowsSkeleton /> : suggestionsQ.isError ? (
              <ErrorState onRetry={() => suggestionsQ.refetch()} />
            ) : suggestions.length === 0 ? (
              <EmptyState title={t('friends.suggestionsEmptyTitle')} body={t('friends.suggestionsEmptyBody')}
                action={<ExploreLink />} />
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>{t('friends.suggestionsBasis')}</p>
                <motion.ul initial="hidden" animate="show" variants={listContainerVariants} style={GRID}>
                  {suggestions.map((u: any) => {
                    const req = requestStates[u.username]
                    const follow = followStates[u.username]
                    return (
                      <PersonRow key={u.id} person={u} context={suggestionContext(u, t)}>
                        {nameId => (
                          <>
                            {req === 'sent' || req === 'restricted' ? (
                              <button type="button" disabled aria-describedby={nameId} style={BTN_DONE}
                                title={req === 'restricted' ? t('profile.friendRequestRestricted') : undefined}>
                                {req === 'sent' ? t('friends.sent') : t('friends.restricted')}
                              </button>
                            ) : (
                              <button type="button" disabled={req === 'sending'} aria-busy={req === 'sending'} aria-describedby={nameId}
                                onClick={() => friendReqMutation.mutate(u.username)}
                                style={{ ...BTN_PRIMARY, opacity: req === 'sending' ? 0.7 : 1 }}>
                                {req === 'sending' ? t('friends.sending') : t('friends.add')}
                              </button>
                            )}
                            {follow === 'following' ? (
                              <button type="button" disabled aria-describedby={nameId} style={BTN_DONE}>{t('follow.following')}</button>
                            ) : (
                              <button type="button" disabled={follow === 'pending'} aria-busy={follow === 'pending'} aria-describedby={nameId}
                                onClick={() => followMutation.mutate(u.username)}
                                style={{ ...BTN_SECONDARY, opacity: follow === 'pending' ? 0.7 : 1 }}>
                                {t('follow.follow')}
                              </button>
                            )}
                          </>
                        )}
                      </PersonRow>
                    )
                  })}
                </motion.ul>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}

// Only real, server-supplied context — never fabricated. `mutual_count` is
// mutual FOLLOWS (services/suggestions.ts), hence "connections", not
// "friends". `location_hint` is rendered only if a future payload sends it.
export function suggestionContext(u: any, t: ReturnType<typeof useT>): string {
  const parts = [`@${u.username}`]
  if (u.mutual_count > 0) {
    parts.push(t(u.mutual_count === 1 ? 'onboarding.reasonMutual' : 'onboarding.reasonMutualPlural', { count: String(u.mutual_count) }))
  } else if (u.tagline) {
    parts.push(u.tagline)
  }
  if (u.location_hint) parts.push(u.location_hint)
  return parts.join(' · ')
}

function PersonRow({ person, context, children }: {
  person: any; context: string; children: (nameId: string) => React.ReactNode
}) {
  const t = useT()
  const nameId = useId()
  const name = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.username
  const path = `/u/${person.username}`
  return (
    <motion.li variants={listItemVariants} style={ROW} data-testid="person-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 140px', minWidth: 0 }}>
        <Link to={path} aria-label={t('avatar.viewProfile', { name })} data-testid="person-avatar-link"
          style={{ display: 'block', padding: 2, margin: -2, borderRadius: '50%', flexShrink: 0, textDecoration: 'none' }}>
          <Avatar src={person.profile_pic_url} name={person.first_name || person.username} size="lg" />
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Link to={path} id={nameId} data-testid="person-name-link"
              style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {name}
            </Link>
            <VerifiedBadge verified={person.is_verified_badge} size={15} />
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{context}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
        {children(nameId)}
      </div>
    </motion.li>
  )
}

function RowsSkeleton() {
  return (
    <ul style={GRID} aria-hidden="true" data-testid="friends-skeleton">
      {[1, 2, 3, 4].map(i => (
        <li key={i} style={{ ...ROW, boxShadow: 'none' }}>
          <div className="skeleton-bone" style={{ width: 48, height: 48, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-bone" style={{ height: 12, width: '55%', borderRadius: 6, marginBottom: 6 }} />
            <div className="skeleton-bone" style={{ height: 10, width: '35%', borderRadius: 6 }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text4)" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginBottom: 12 }}>
        <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5.5 5" />
      </svg>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 20 }}>{body}</div>
      {action}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <div role="alert" style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{t('follow.errorTitle')}</div>
      <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 16 }}>{t('follow.errorBody')}</div>
      <button type="button" onClick={onRetry} style={BTN_PRIMARY}>{t('follow.retry')}</button>
    </div>
  )
}

function ExploreLink() {
  const t = useT()
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/explore')} style={BTN_PRIMARY}>{t('feed.exploreSpandik')}</button>
}
