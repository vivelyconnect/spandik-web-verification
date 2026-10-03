// src/pages/Buzz.tsx — Notifications feed
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { m as motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { notifApi } from '../utils/api'
import Avatar from '../components/ui/Avatar'
import { useT } from '../i18n/useT'
import { AtSign, Bell, Handshake, Heart, KeyRound, Megaphone, MessageCircle, Reply, Tag, UserCheck, UserPlus, type LucideIcon } from 'lucide-react'

// SP-5-15: one coherent (Lucide) icon per notification type — each type
// distinct, so a friend request and its acceptance never look alike.
export const NOTIF_ICONS: Record<string, LucideIcon> = {
  follow: UserPlus, reaction: Heart, comment: MessageCircle, tag: Tag, reply: Reply,
  friend_request: Handshake, friend_request_accepted: UserCheck, mention: AtSign, system: Megaphone, key_change: KeyRound,
}

export default function Buzz() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const t = useT()

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notifApi.list().then(r => r.data.data || { notifications: [], unread_count: 0 }),
  })

  const readAll = useMutation({
    mutationFn: () => notifApi.readAll(),
    // SP-5-14: the top-nav bell badge polls a *separate* query (['notif-badge']
    // in AppShell.tsx) from this page's own ['notifications'] — both need
    // invalidating or the persistent badge would linger until its next
    // 30s poll instead of clearing the moment this screen is opened.
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-badge'] }) },
  })

  // SP-5-14: opening the notifications screen clears the badge automatically
  // (matching ChatRoom's existing auto-mark-read-on-open behavior) — no
  // manual "Mark all read" click required. Guarded to fire at most once per
  // mount, only when there's genuinely something unread.
  const markedRef = useRef(false)
  useEffect(() => {
    if (!markedRef.current && data && data.unread_count > 0) {
      markedRef.current = true
      readAll.mutate()
    }
  }, [data])

  const notifications = data?.notifications || []
  const unread = data?.unread_count || 0

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{t('buzz.title')}</h1>
          {unread > 0 && <div style={{ fontSize: 13, color: 'var(--text4)' }}>{t('buzz.unreadCount', { count: String(unread) })}</div>}
        </div>
        {unread > 0 && (
          <button onClick={() => readAll.mutate()}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--brand-light)', color: 'var(--link)', border: 'none', cursor: 'pointer' }}>
            {t('buzz.markAllRead')}
          </button>
        )}
      </div>

      {isLoading && (
        <div aria-hidden="true">
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px' }}>
              <div className="skeleton-bone" style={{ width: 40, height: 40, borderRadius: '50%' }} />
              <div style={{ flex: 1 }}><div className="skeleton-bone" style={{ height: 12, width: '70%', borderRadius: 6, marginBottom: 6 }} /><div className="skeleton-bone" style={{ height: 10, width: '30%', borderRadius: 6 }} /></div>
            </div>
          ))}
        </div>
      )}

      {notifications.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Bell size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--text4)' }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('buzz.caughtUp')}</div>
          <div style={{ color: 'var(--text4)', marginBottom: 20 }}>{t('buzz.noNewNotifications')}</div>
          <button onClick={() => navigate('/')}
            style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
            {t('feed.exploreSpandik')}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {notifications.map((n: any) => (
          <motion.button type="button" key={n.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            onClick={() => { notifApi.read(n.id); if (n.link) navigate(n.link) }}
            style={{ width: '100%', textAlign: 'left', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: n.is_read ? 'var(--white)' : 'var(--brand-light)', border: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.2s' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar src={n.actor?.profile_pic_url} name={n.actor?.first_name || 'S'} size={40} />
              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, border: '1px solid var(--border)' }}>
                {(() => { const I = NOTIF_ICONS[n.type] || Megaphone; return <I size={12} aria-hidden /> })()}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.4 }}>{n.message}</div>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 2 }}>{timeAgo(n.created_at, t)}</div>
            </div>
            {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', flexShrink: 0 }} />}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function timeAgo(d: string, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - new Date(d).getTime()
  if (diff < 60000) return t('buzz.justNow')
  if (diff < 3600000) return t('buzz.minutesAgo', { n: String(Math.floor(diff/60000)) })
  if (diff < 86400000) return t('buzz.hoursAgo', { n: String(Math.floor(diff/3600000)) })
  return t('buzz.daysAgo', { n: String(Math.floor(diff/86400000)) })
}
