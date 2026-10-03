// src/pages/Chats.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { m as motion, AnimatePresence } from 'framer-motion'
import { api } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import Avatar from '../components/ui/Avatar'
import { MessageCircle, Search, SquarePen, UserX, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../i18n/useT'
import { apiAgeMs } from '../utils/time'

export default function Chats() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const qc        = useQueryClient()
  const t = useT()
  const [q, setQ] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [starting, setStarting] = useState<string | null>(null)

  const { data: threads, isLoading } = useQuery({
    queryKey: ['chat-threads'],
    queryFn: () => api.get('/chat/threads').then(r => r.data.data || []),
    refetchInterval: 5000,         // poll every 5s as WS-push fallback
    refetchOnWindowFocus: true,
    staleTime: 2000,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQ],
    queryFn: () => api.get('/search', { params: { q: searchQ, type: 'users', limit: 8 } }).then(r => r.data.data?.users || []),
    enabled: searchQ.length >= 2,
    staleTime: 3000,
  })

  async function startChat(userId: string) {
    setStarting(userId)
    try {
      const res = await api.post('/chat/threads', { user_id: userId })
      const threadId = res.data.data?.thread_id
      if (threadId) {
        setShowNewChat(false)
        qc.invalidateQueries({ queryKey: ['chat-threads'] })
        navigate(`/chats/${threadId}`)
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('chat.cannotStartChat'))
    } finally { setStarting(null) }
  }

  async function acceptRequest(threadId: string) {
    try {
      await api.post(`/chat/threads/${threadId}/accept`)
      qc.invalidateQueries({ queryKey: ['chat-threads'] })
    } catch { toast.error(t('chat.acceptRequestFailed')) }
  }

  async function declineRequest(threadId: string) {
    try {
      await api.post(`/chat/threads/${threadId}/decline`)
      qc.invalidateQueries({ queryKey: ['chat-threads'] })
    } catch { toast.error(t('chat.declineRequestFailed')) }
  }

  const allThreads = (threads || []) as any[]

  // Separate accepted vs pending requests TO me (I'm recipient = is_sender false + pending)
  const accepted  = allThreads.filter(t => t.request_status === 'accepted' || t.is_sender)
  const requests  = allThreads.filter(t => t.request_status === 'pending' && !t.is_sender)

  const filtered = accepted.filter((t: any) =>
    !q ||
    t.other_user?.first_name?.toLowerCase().includes(q.toLowerCase()) ||
    t.other_user?.username?.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100vh', maxHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', background: 'var(--white)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t('chat.title')}</h1>
          <motion.button whileTap={{ scale: 0.95 }}
            onClick={() => setShowNewChat(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', minHeight: 44, borderRadius: 99, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, boxShadow: 'var(--shadow-brand)' }}>
            <SquarePen size={18} aria-hidden />{t('chat.newMessage')}
          </motion.button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder={t('chat.searchConversations')}
          style={{ width: '100%', padding: '9px 14px', background: 'var(--bg2)', border: '1.5px solid var(--border)', borderRadius: 99, fontSize: 13.5, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && [1,2,3,4].map(i => <ThreadSkeleton key={i} />)}

        {/* Message Requests section */}
        {requests.length > 0 && (
          <div>
            <div style={{ padding: '10px 16px 6px', fontSize: 11.5, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: 0.5, background: 'var(--bg2)' }}>
              {t('chat.messageRequests')} ({requests.length})
            </div>
            {requests.map((thread: any) => (
              <RequestRow key={thread.id} thread={thread} currentUserId={user?.id || ''}
                onOpen={() => navigate(`/chats/${thread.id}`)}
                onAccept={() => acceptRequest(thread.id)}
                onDecline={() => declineRequest(thread.id)} />
            ))}
            {filtered.length > 0 && (
              <div style={{ padding: '8px 16px 4px', fontSize: 11.5, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: 0.5, background: 'var(--bg2)' }}>
                {t('chat.messagesSectionLabel')}
              </div>
            )}
          </div>
        )}

        {!isLoading && filtered.length === 0 && requests.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <MessageCircle size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--text4)' }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
              {q ? t('chat.noConversationsFound') : t('chat.emptyTitle')}
            </div>
            <div style={{ color: 'var(--text4)', marginBottom: 24, fontSize: 14 }}>
              {q ? t('chat.tryDifferentName') : t('chat.emptyBody')}
            </div>
            {!q && (
              <button onClick={() => setShowNewChat(true)}
                style={{ minHeight: 44, padding: '11px 24px', borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                {t('chat.startConversation')}
              </button>
            )}
          </div>
        )}

        {filtered.map((thread: any) => (
          <ThreadRow key={thread.id} thread={thread} currentUserId={user?.id || ''} onClick={() => navigate(`/chats/${thread.id}`)} />
        ))}
      </div>

      {/* New chat modal */}
      <AnimatePresence>
        {showNewChat && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowNewChat(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: 'blur(4px)' }}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 600, background: 'var(--white)', borderRadius: '20px 20px 0 0', padding: '20px 16px', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{t('chat.newMessage')}</span>
                <button onClick={() => setShowNewChat(false)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', fontSize: 13, fontWeight: 600, minWidth: 44, minHeight: 44, cursor: 'pointer', color: 'var(--text4)' }}><X size={16} aria-hidden />{t('overlay.close')}</button>
              </div>
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder={t('chat.searchPeoplePlaceholder')}
                autoFocus
                style={{ width: '100%', padding: '10px 14px', background: 'var(--bg2)', border: '1.5px solid var(--input-border)', borderRadius: 99, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }} />
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {searchQ.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text4)' }}>
                    <Search size={28} strokeWidth={1.5} aria-hidden style={{ marginBottom: 8 }} />
                    <div style={{ fontSize: 13 }}>{t('chat.typeNameToFindPeople')}</div>
                  </div>
                )}
                {searchQ.length > 0 && (!searchResults || searchResults.length === 0) && (
                  <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text4)' }}>
                    <UserX size={28} strokeWidth={1.5} aria-hidden style={{ marginBottom: 8 }} />
                    <div style={{ fontSize: 13 }}>{t('chat.noUsersFoundFor', { query: searchQ })}</div>
                  </div>
                )}
                {(searchResults || []).map((u: any) => (
                  <motion.div key={u.id} whileHover={{ background: 'var(--bg2)' }} whileTap={{ scale: 0.98 }}
                    onClick={() => startChat(u.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderRadius: 10, cursor: 'pointer', transition: 'background 0.1s' }}>
                    <Avatar src={u.profile_pic_url} name={u.first_name} size={42} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{u.first_name} {u.last_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text4)' }}>@{u.username}</div>
                    </div>
                    {starting === u.id
                      ? <div style={{ fontSize: 12, color: 'var(--text4)' }}>{t('chat.startingEllipsis')}</div>
                      : <div style={{ fontSize: 12, color: 'var(--link)', fontWeight: 600 }}>{t('chat.messageArrow')}</div>
                    }
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RequestRow({ thread, currentUserId, onOpen, onAccept, onDecline }: {
  thread: any; currentUserId: string; onOpen: () => void; onAccept: () => void; onDecline: () => void
}) {
  const t = useT()
  const other = thread.other_user
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--divider)', background: 'var(--white)' }}>
      <button type="button" onClick={onOpen} aria-label={other ? `${other.first_name} ${other.last_name}` : undefined} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textAlign: 'left', color: 'inherit', cursor: 'pointer', flexShrink: 0, borderRadius: '50%' }}>
        <Avatar src={other?.profile_pic_url} name={other?.first_name || '?'} size={48} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
          {other?.first_name} {other?.last_name}
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text4)', marginLeft: 6 }}>@{other?.username}</span>
        </div>
        {thread.is_sender ? (
          <div style={{ fontSize: 12.5, color: 'var(--text4)' }}>{t('chat.waitingForAccept')}</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={onAccept}
              style={{ padding: '5px 14px', minHeight: 44, borderRadius: 99, fontSize: 12.5, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
              {t('friends.accept')}
            </button>
            <button onClick={onDecline}
              style={{ padding: '5px 14px', minHeight: 44, borderRadius: 99, fontSize: 12.5, fontWeight: 600, background: 'var(--bg2)', color: 'var(--text4)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              {t('friends.decline')}
            </button>
            <button onClick={onOpen}
              style={{ padding: '5px 14px', minHeight: 44, borderRadius: 99, fontSize: 12.5, fontWeight: 600, background: 'transparent', color: 'var(--link)', border: 'none', cursor: 'pointer' }}>
              {t('chat.preview')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadRow({ thread, currentUserId, onClick }: { thread: any; currentUserId: string; onClick: () => void }) {
  const t = useT()
  const other   = thread.other_user
  const lastMsg = thread.last_message
  const unread  = thread.unread_count || 0
  const isPending = thread.request_status === 'pending'

  const timeAgo = (d: string) => {
    const diff = apiAgeMs(d)
    if (Number.isNaN(diff)) return ''
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`
    return `${Math.floor(diff/86400000)}d`
  }

  const preview = () => {
    if (!lastMsg) return isPending ? t('chat.pendingRequestEllipsis') : t('chat.startConversationNoArrow')
    if (lastMsg.is_deleted) return t('chat.messageDeleted')
    if (lastMsg.type === 'image') return t('chat.photoLabel')
    if (lastMsg.type === 'audio') return t('chat.voiceMessageLabel')
    const isMe = lastMsg.sender_id === currentUserId
    // SP-0-02: never fall back to rendering content_encrypted — it's ciphertext, not text.
    const text  = lastMsg.content_plain || t('chat.encryptedLabel')
    return isMe ? t('chat.youPrefix', { text }) : text
  }

  return (
    <motion.button type="button" whileHover={{ background: 'var(--bg2)' }} onClick={onClick}
      style={{ width: '100%', textAlign: 'left', fontFamily: 'inherit', border: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--divider)', background: unread > 0 ? 'var(--brand-light)' : 'transparent', transition: 'background 0.15s', opacity: isPending ? 0.75 : 1 }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {/* SP-5-08: the shared Avatar owns the presence dot (sized to the
            avatar, with an accessible "Online" name — no longer color-only). */}
        <Avatar src={other?.profile_pic_url} name={other?.first_name || '?'} size="lg" online={thread.is_online === true} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 14.5, fontWeight: unread > 0 ? 700 : 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {other?.first_name} {other?.last_name}
            {isPending && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text4)', marginLeft: 6, background: 'var(--bg2)', padding: '1px 6px', borderRadius: 99 }}>{t('chat.pendingBadge')}</span>}
          </span>
          <span style={{ fontSize: 11, color: unread > 0 ? 'var(--link)' : 'var(--text4)', flexShrink: 0, marginLeft: 8 }}>
            {timeAgo(lastMsg?.created_at || thread.created_at)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: unread > 0 ? 'var(--text2)' : 'var(--text4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread > 0 ? 600 : 400 }}>
            {preview()}
          </span>
          {unread > 0 && (
            <div style={{ minWidth: 20, height: 20, borderRadius: 10, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0, marginLeft: 8 }}>
              {unread > 99 ? '99+' : unread}
            </div>
          )}
        </div>
      </div>
    </motion.button>
  )
}

function ThreadSkeleton() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--divider)' }}>
      <div className="skeleton-bone" style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton-bone" style={{ height: 13, width: '40%', borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-bone" style={{ height: 11, width: '65%', borderRadius: 6 }} />
      </div>
    </div>
  )
}
