// src/pages/ChatRoom.tsx
import { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { m as motion, AnimatePresence } from 'framer-motion'
import { encodeBase64 } from 'tweetnacl-util'
import { api } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import { usePinModalStore } from '../stores/pinModalStore'
import { useChat } from '../hooks/useChat'
import { hasKeys, getMyPublicKey, getPinnedKey } from '../utils/e2e'
import { isVerified } from '../utils/safetyNumber'
import Avatar from '../components/ui/Avatar'
import { ArrowLeft, Info, Ban, ShieldCheck, CircleAlert, Clock, Ellipsis, Flag, KeyRound, Lock, MessageCircle, Paperclip, SendHorizontal, Trash2, TriangleAlert, Video as VideoIcon } from 'lucide-react'
import ReportModal from '../components/ui/ReportModal'
import toast from 'react-hot-toast'
import { useT } from '../i18n/useT'
import { parseApiTime } from '../utils/time'
import { shapeOf, classifyChange, isNearBottom, prependAnchorTop, followsAppend } from '../utils/chatScroll'

// SP-14-03: only loaded when someone opens it (carries the QR encoder)
const SafetyNumberModal = lazy(() => import('../components/chat/SafetyNumberModal'))

export default function ChatRoom() {
  const { id, username: targetUsername } = useParams<{ id?: string; username?: string }>()
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const t = useT()
  const openPinModal = usePinModalStore(s => s.openPinModal)
  // Re-render live the moment keys are restored (here, in Settings, or via
  // the auto-popup) so this banner disappears without needing a remount.
  usePinModalStore(s => s.keysVersion)
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const typingTimer    = useRef<ReturnType<typeof setTimeout>>()

  const [input, setInput]       = useState('')
  const [showInfo, setShowInfo] = useState(false) // SP-14-03: opens the safety-number check
  const [, setVerifyTick] = useState(0)
  const [resolvedId, setResolvedId] = useState(id)
  const [accepting, setAccepting] = useState(false)

  // If accessed via /chats/new/:username, resolve to thread ID
  useEffect(() => {
    if (targetUsername && !id) {
      api.get(`/users/${targetUsername}`).then(r => {
        const userId = r.data.data?.id
        if (!userId) { navigate('/chats'); return }
        api.post('/chat/threads', { user_id: userId }).then(res => {
          const threadId = res.data.data?.thread_id
          if (threadId) {
            navigate(`/chats/${threadId}`, { replace: true })
          }
        }).catch(() => navigate('/chats'))
      }).catch(() => navigate('/chats'))
    }
  }, [targetUsername, id])

  const { messages, typing, reconnecting, sendMessage, sendImage, sendTyping, markThreadSeen, loadMore, hasMore, loading, recipientHasKey, requestStatus, isSender, retryMessage, keyChangeWarning, acceptKeyChange, deleteMessage } = useChat(resolvedId || id)

  // Thread metadata (other user info). SP-3-01: was a one-shot fetch, so
  // the online dot only ever updated on navigation/remount — a bounded
  // refetch is the smallest reliable way to make it live while the room
  // stays open. React Query's default `refetchIntervalInBackground: false`
  // already pauses this while the tab is hidden, no extra visibility
  // handling needed here.
  const { data: thread } = useQuery({
    queryKey: ['thread', id],
    queryFn: () => api.get(`/chat/threads/${id}`).then(r => r.data.data),
    enabled: !!id,
    refetchInterval: 15000,
  })

  const other = thread?.other_user

  // ── Message-list scroll state (UAT: opened mid-history; load-older jumped
  // to the bottom; new messages yanked readers out of history). Rules live in
  // utils/chatScroll.ts. Only the LIST scrolls — never the page.
  const pinnedRef = useRef(true)                     // reader is at the newest message
  const shapeRef = useRef(shapeOf([], undefined))
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const toBottom = () => { const l = listRef.current; if (l) l.scrollTop = l.scrollHeight }
  useLayoutEffect(() => {
    const list = listRef.current
    const next = shapeOf(messages, user?.id)
    const kind = classifyChange(shapeRef.current, next)
    if (kind === 'initial') { pinnedRef.current = true; toBottom() }       // instant, before paint
    else if (kind === 'prepend' && list && anchorRef.current) list.scrollTop = prependAnchorTop(anchorRef.current.height, anchorRef.current.top, list.scrollHeight)
    else if (kind === 'append' && followsAppend(pinnedRef.current, next.lastMine)) { pinnedRef.current = true; toBottom() }
    anchorRef.current = null
    shapeRef.current = next
  }, [messages, user?.id])
  // Images decoding, the typing indicator, tombstones, a growing composer or
  // the keyboard all change heights after render: while pinned, stay pinned.
  useEffect(() => {
    const list = listRef.current, content = contentRef.current
    if (!list || !content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (pinnedRef.current) toBottom() })
    ro.observe(list); ro.observe(content)
    return () => ro.disconnect()
  }, [])
  function onListScroll() {
    const l = listRef.current
    if (l) pinnedRef.current = isNearBottom(l.scrollHeight, l.scrollTop, l.clientHeight)
  }
  function loadOlder() {
    const l = listRef.current
    if (l) anchorRef.current = { height: l.scrollHeight, top: l.scrollTop }
    loadMore()
  }

  // ── Room height: exactly the visible area between the shell's top bar and
  // its bottom nav — or the keyboard, when one is open (the nav is hidden
  // then: html.kb-open, utils/keyboardViewport.ts). Re-measured whenever
  // anything can move it: visual viewport resize/scroll (keyboard, URL bar,
  // rotation), the shell above settling (UAT: sized once at mount, the room
  // later sat 7–33px above the nav), and the keyboard state toggling.
  const rootRef = useRef<HTMLDivElement>(null)
  const [roomHeight, setRoomHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    let raf = 0
    const fit = () => {
      const el = rootRef.current; if (!el) return
      const vv = window.visualViewport
      // iOS pans the page to the focused field instead of resizing; undo it so
      // the room header stays on screen (Android: resizes-content, no pan).
      if (vv && vv.offsetTop > 0 && document.documentElement.classList.contains('kb-open')) window.scrollTo(0, 0)
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight   // viewport coords
      const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav')
      const navReserve = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0
      const h = Math.max(200, Math.floor(visibleBottom - el.getBoundingClientRect().top - navReserve))
      setRoomHeight(prev => prev === h ? prev : h)
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit) }   // after kb-open has toggled
    fit()
    const vv = window.visualViewport
    const shell = rootRef.current?.parentElement
    const ro = typeof ResizeObserver !== 'undefined' && shell ? new ResizeObserver(schedule) : null
    if (ro && shell) ro.observe(shell)
    window.addEventListener('resize', schedule); window.addEventListener('spandik:viewport', schedule)
    vv?.addEventListener('resize', schedule); vv?.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(raf); ro?.disconnect()
      window.removeEventListener('resize', schedule); window.removeEventListener('spandik:viewport', schedule)
      vv?.removeEventListener('resize', schedule); vv?.removeEventListener('scroll', schedule)
    }
  }, [])

  // Mark every currently-unread message in this thread as seen in one
  // batch operation (SP-3-04) — see useChat.ts's markThreadSeen for the
  // full story.
  useEffect(() => {
    markThreadSeen()
  }, [messages, markThreadSeen])

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    sendTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => sendTyping(false), 2000)

    // Auto-resize textarea
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  function handleSend() {
    if (!input.trim()) return
    sendMessage(input.trim())
    setInput('')
    sendTyping(false)
    clearTimeout(typingTimer.current)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleAccept() {
    if (!resolvedId && !id) return
    setAccepting(true)
    try {
      await api.post(`/chat/threads/${resolvedId || id}/accept`)
      window.location.reload()
    } catch {
      setAccepting(false)
      toast.error(t('chat.acceptRequestGenericFailed'))
    }
  }

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !canSendMedia) return
    sendImage(file)
  }

  const isTyping = typing.length > 0
  // Sender can always send even when pending; recipient must accept first
  const canSend = requestStatus !== 'declined' && (isSender || requestStatus !== 'pending') && recipientHasKey !== false
  // SP-15-17: text only until the recipient accepts — matches the real
  // server-side gate in chat.ts's POST /threads/:id/messages (which is the
  // actual enforcement point; this only keeps the UI from offering an action
  // the server will reject).
  const canSendMedia = canSend && requestStatus !== 'pending'

  // SP-14-03: both identity keys as this device knows them — the contact's is
  // the TOFU-pinned one (what messages are actually encrypted to).
  const myKey = user?.id ? getMyPublicKey(user.id) : null
  const contactKey = user?.id && other?.id ? getPinnedKey(user.id, other.id) : null
  const verified = !!(user?.id && other?.id && isVerified(user.id, other.id, contactKey))

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: roomHeight ?? '100dvh', maxWidth: 680, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--white)', borderBottom: '1px solid var(--border)', flexShrink: 0, boxShadow: 'var(--shadow-sm)' }}>
        <button onClick={() => navigate('/chats')}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text3)', padding: '4px 8px 4px 0', minHeight: 44 }}>
          <ArrowLeft size={20} aria-hidden />{t('chat.back')}
        </button>
        <button type="button" aria-label={other ? t('avatar.viewProfile', { name: `${other.first_name} ${other.last_name}` }) : undefined}
          style={{ position: 'relative', cursor: 'pointer', background: 'none', border: 'none', padding: 3, margin: -3, borderRadius: '50%' }} onClick={() => other && navigate(`/u/${other.username}`)}>
          <Avatar src={other?.profile_pic_url} name={other?.first_name || '?'} size={38} online={thread?.is_online === true} />
        </button>
        <button type="button" style={{ flex: 1, minWidth: 0, cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit', minHeight: 44 }} onClick={() => other && navigate(`/u/${other.username}`)}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{other?.first_name} {other?.last_name}</div>
          <div style={{ fontSize: 11.5, color: thread?.is_online ? 'var(--success)' : 'var(--text4)' }}>
            {thread?.is_online ? t('chat.online') : other ? `@${other.username}` : ''}
            {verified && (
              <span data-testid="contact-verified" style={{ marginLeft: 6, color: 'var(--success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
                <ShieldCheck size={12} aria-hidden />{t('chat.verifyVerified')}
              </span>
            )}
          </div>
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => navigate(`/connect?user=${other?.id}&username=${other?.username}`)}
            style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <VideoIcon size={16} aria-hidden />
            <span style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--text4)' }}>{t('chat.call')}</span>
          </button>
          <button onClick={() => (myKey && contactKey ? setShowInfo(true) : toast(t('chat.verifyNoKey')))} aria-label={t('chat.verifyTitle')}
            style={{ width: 44, height: 44, borderRadius: 12, background: showInfo ? 'var(--brand-light)' : 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <Info size={16} aria-hidden />
            <span style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--text4)' }}>{t('chat.info')}</span>
          </button>
        </div>
      </div>

      {showInfo && user?.id && other?.id && myKey && contactKey && (
        <Suspense fallback={null}>
          <SafetyNumberModal me={{ id: user.id, key: myKey }} contact={{ id: other.id, key: contactKey, name: other.first_name }}
            onClose={() => setShowInfo(false)} onChange={() => setVerifyTick(n => n + 1)} />
        </Suspense>
      )}

      {/* Status banner */}
      {user?.id && !hasKeys(user.id) ? (
        // Skipped the PinModal earlier — nothing here can be decrypted or
        // sent until they unlock. Takes priority over every other banner.
        <div style={{ background: 'var(--warning-bg)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <KeyRound size={14} aria-hidden />
          <span style={{ fontSize: 11.5, color: 'var(--warning-text)', fontWeight: 600, flex: 1 }}>
            {t('chat.enterPinToUnlockThisChat')}
          </span>
          <button onClick={() => openPinModal()}
            style={{ minHeight: 44, padding: '4px 14px', borderRadius: 8, background: 'var(--warning-fill)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {t('chat.enterPinButton')}
          </button>
        </div>
      ) : keyChangeWarning && keyChangeWarning.contactId === other?.id ? (
        // SP-1-08: TOFU pinning tripped — the server is now handing back a
        // different identity key for this contact than this device pinned
        // on first contact. Could be a new phone, could be a substitution —
        // block sending until the user explicitly accepts the new key.
        // Checked first: a security warning takes priority over routine
        // request-pending status banners below.
        <div style={{ background: 'var(--danger-bg)', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TriangleAlert size={14} aria-hidden />
            <span style={{ fontSize: 11.5, color: 'var(--danger-strong)', fontWeight: 600 }}>
              {t('chat.securityKeyChanged', { name: other?.first_name || t('chat.thisContact') })}
            </span>
          </div>
          <button onClick={acceptKeyChange}
            style={{ alignSelf: 'flex-start', minHeight: 44, padding: '5px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, background: 'var(--danger-fill)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {t('chat.trustThisKey')}
          </button>
        </div>
      ) : requestStatus === 'declined' ? (
        // UAT P2: a declined request is closed (the server refuses sends and
        // the live channel). Only the recipient can deliberately reopen it.
        <div style={{ background: 'var(--bg2)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Ban size={14} aria-hidden />
          <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600, flex: 1 }}>
            {isSender ? t('chat.requestClosedSender') : t('chat.requestDeclinedByYou')}
          </span>
          {!isSender && (
            <button onClick={handleAccept} disabled={accepting}
              style={{ minHeight: 44, padding: '4px 14px', borderRadius: 8, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {accepting ? '...' : t('chat.reopenChat')}
            </button>
          )}
        </div>
      ) : requestStatus === 'pending' && !isSender ? (
        // Recipient sees Accept button
        <div style={{ background: 'var(--warning-bg)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <MessageCircle size={14} aria-hidden />
          <span style={{ fontSize: 11.5, color: 'var(--warning-text)', fontWeight: 600, flex: 1 }}>
            {t('chat.messageRequestFrom', { name: other?.first_name || t('chat.thisUserLower') })}
          </span>
          <button onClick={handleAccept} disabled={accepting}
            style={{ minHeight: 44, padding: '4px 14px', borderRadius: 8, background: 'var(--warning-fill)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {accepting ? '...' : t('friends.accept')}
          </button>
        </div>
      ) : requestStatus === 'pending' && isSender ? (
        // Sender sees a waiting status
        <div style={{ background: 'var(--bg2)', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11 }}>⏳</span>
          <span style={{ fontSize: 11, color: 'var(--text4)', fontWeight: 600 }}>
            {t('chat.waitingForRecipientToAccept', { name: other?.first_name || t('chat.theRecipient') })}
          </span>
        </div>
      ) : recipientHasKey === false ? (
        <div style={{ background: 'var(--warning-bg)', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <TriangleAlert size={14} aria-hidden />
          <span style={{ fontSize: 11, color: 'var(--warning-text)', fontWeight: 600 }}>
            {t('chat.userHasntOpenedApp', { name: other?.first_name || t('chat.thisUser') })}
          </span>
        </div>
      ) : (
        <div style={{ background: 'var(--brand-light)', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Lock size={13} aria-hidden style={{ color: 'var(--link)' }} />
          <span style={{ fontSize: 11, color: 'var(--link)', fontWeight: 600 }}>{t('chat.e2eEncryptedNotice')}</span>
        </div>
      )}

      {/* Messages area */}
      <div ref={listRef} onScroll={onListScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div ref={contentRef} style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Load more */}
        {hasMore && (
          <button onClick={loadOlder}
            style={{ alignSelf: 'center', padding: '6px 14px', borderRadius: 99, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, color: 'var(--text4)', marginBottom: 8 }}>
            {t('chat.loadOlderMessages')}
          </button>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text4)', fontSize: 13 }}>{t('chat.loadingMessagesEllipsis')}</div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <Avatar src={other?.profile_pic_url} name={other?.first_name || '?'} size={64} style={{ marginBottom: 16 }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              {other?.first_name} {other?.last_name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text4)', marginBottom: 4 }}>@{other?.username}</div>
            <div style={{ fontSize: 13, color: 'var(--text4)', marginTop: 16 }}>
              {t('chat.sayHelloEmptyState')}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const isMe     = msg.sender_id === user?.id
          const prevMsg  = messages[i - 1]
          const showAvatar = !isMe && (!prevMsg || prevMsg.sender_id !== msg.sender_id)
          // SP-3-04: real bug fix — this used to also require `isLast`, so
          // only the single most recent own message could ever show ✓✓;
          // every earlier one showed a plain ✓ regardless of its actual
          // seen_by content, even though that data was always correct
          // (the durable batch mark-seen already covered every unread
          // message, not just the last). Each bubble now reflects its own
          // real seen state.
          const allSeen  = isMe && !!msg.seen_by?.some((id: string) => id !== user?.id)

          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMe={isMe}
              showAvatar={showAvatar}
              senderPic={other?.profile_pic_url}
              senderName={other?.first_name || ''}
              allSeen={allSeen}
              onRetry={retryMessage}
              onDelete={deleteMessage}
            />
          )
        })}

        {/* Typing indicator */}
        <AnimatePresence>
          {isTyping && (
            <motion.div key="typing" data-testid="typing-indicator" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar src={other?.profile_pic_url} name={other?.first_name || '?'} size={28} />
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '4px 16px 16px 16px', padding: '10px 14px', display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0,1,2].map(i => (
                  <motion.div key={i}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text4)' }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
      </div>

      {/* Input area */}
      <div style={{ padding: '10px 12px', background: 'var(--white)', borderTop: '1px solid var(--border)', flexShrink: 0, paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
          {/* Attachment button — clickable but explains why while a message
              request is still pending (SP-15-17), rather than a silently
              disabled button with no explanation (UI Law 2: no hidden
              gesture-only actions). Fully disabled only when sending is
              unavailable for an unrelated reason (e.g. no recipient key). */}
          <button
            onClick={() => canSendMedia ? fileInputRef.current?.click() : toast(t('chat.textOnlyUntilAccepted'))}
            disabled={!canSend} aria-label={t('chat.attachPhoto')}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg2)', border: '1px solid var(--border)', cursor: canSend ? 'pointer' : 'default', opacity: canSendMedia ? 1 : 0.5, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Paperclip size={20} aria-hidden />
          </button>

          {/* Text input */}
          <div style={{ flex: 1, background: 'var(--input-bg)', border: '1.5px solid var(--input-border)', borderRadius: 20, padding: '8px 14px', display: 'flex', alignItems: 'flex-end', gap: 8, opacity: canSend ? 1 : 0.5 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={requestStatus === 'declined' ? (isSender ? t('chat.requestClosedSender') : t('chat.requestDeclinedByYou')) : !canSend ? t('chat.cannotSendPlaceholder') : t('chat.messagePlaceholder')}
              rows={1}
              disabled={!canSend}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none', fontSize: 14, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflow: 'auto' }}
            />
          </div>

          {/* Send button */}
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleSend}
            disabled={!input.trim() || !canSend}
            aria-label={t('chat.sendMessageAriaLabel')}
            style={{ width: 44, height: 44, borderRadius: '50%', background: (input.trim() && canSend) ? 'var(--btn-primary-bg)' : 'var(--bg2)', border: 'none', cursor: (input.trim() && canSend) ? 'pointer' : 'default', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s', boxShadow: (input.trim() && canSend) ? 'var(--shadow-brand)' : 'none', color: (input.trim() && canSend) ? 'var(--btn-primary-text)' : 'var(--text4)' }}>
            <SendHorizontal size={20} aria-hidden />
          </motion.button>
        </div>

        {/* Connection status */}
        {reconnecting && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text4)', marginTop: 4 }}>
            {t('chat.reconnectingEllipsis')}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ msg, isMe, showAvatar, senderPic, senderName, allSeen, onRetry, onDelete }: {
  msg: any; isMe: boolean; showAvatar: boolean; senderPic: string | null; senderName: string; allSeen: boolean
  onRetry: (tempId: string) => void; onDelete: (messageId: string, forEveryone: boolean) => void
}) {
  const t = useT()
  const sentAt = parseApiTime(msg.created_at)
  const timeStr = Number.isNaN(sentAt) ? '' : new Date(sentAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })
  const [showActions, setShowActions] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [evidenceMedia, setEvidenceMedia] = useState<{ base64: string; mime: string } | undefined>()
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>()
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  // The menu portals to document.body (see the render below) — anchoring it
  // relative to the trigger button's own on-screen position, not the local
  // DOM tree, is what makes it immune to the message list's own scroll
  // clipping and to AppShell's sticky header (zIndex 40) sitting visually on
  // top of anything that stays inside the bubble's own stacking context.
  const [menuPos, setMenuPos] = useState<{ bottom: number; left?: number; right?: number } | null>(null)

  // SP-3-03: no server-delete action for a temporary optimistic id (still
  // sending), a failed unsent message, or a message already shown deleted —
  // there is nothing on the server yet to delete, or nothing left to delete.
  const isTemp = typeof msg.id === 'string' && msg.id.startsWith('temp_')
  const hasActions = !msg.is_deleted && !isTemp

  function openMenu() {
    const rect = menuBtnRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPos(isMe
        ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
        : { bottom: window.innerHeight - rect.top + 4, left: rect.left })
    }
    setShowActions(true)
  }
  function onPressStart() {
    if (!hasActions) return
    longPressTimer.current = setTimeout(openMenu, 400)
  }
  function onPressEnd() { clearTimeout(longPressTimer.current) }
  function closeMenu() { setShowActions(false); setConfirmDeleteAll(false) }

  // SP-15-17: re-derive raw bytes from the already-decrypted blob: URL
  // (useChat.ts already did the real decryption; this reads the Blob it
  // already holds directly — never fetch(media_plain_url): that's a blob:
  // URL, and this app's own CSP connect-src has no blob: entry, by design,
  // so a fetch() call on it is silently blocked rather than a real network
  // request) only at the moment the reporter actually opens the report
  // sheet for an image message — never eagerly for every image in the thread.
  async function openReport() {
    if (msg.type === 'image' && msg.media_plain_blob) {
      try {
        const bytes = new Uint8Array(await msg.media_plain_blob.arrayBuffer())
        setEvidenceMedia({ base64: encodeBase64(bytes), mime: msg.media_mime || 'image/jpeg' })
      } catch {
        setEvidenceMedia(undefined)
      }
    }
    setShowReport(true)
    setShowActions(false)
  }

  function handleDeleteForMe() { onDelete(msg.id, false); closeMenu() }
  function handleDeleteForEveryoneClick() { setConfirmDeleteAll(true) }
  function confirmDeleteForEveryone() { onDelete(msg.id, true); closeMenu() }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 6, marginTop: showAvatar ? 8 : 2, alignItems: 'flex-end' }}
    >
      {!isMe && (
        <div style={{ width: 28, flexShrink: 0 }}>
          {showAvatar && <Avatar src={senderPic} name={senderName} size={28} />}
        </div>
      )}

      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexDirection: isMe ? 'row' : 'row-reverse' }}>
        <div
          onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerLeave={onPressEnd}
          style={{
          padding: '9px 13px',
          borderRadius: isMe ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
          background: msg.is_deleted ? 'var(--bg2)' : isMe ? 'var(--btn-primary-bg)' : 'var(--white)',
          color: msg.is_deleted ? 'var(--text4)' : isMe ? 'var(--btn-primary-text)' : 'var(--text)',
          border: (msg.is_deleted || !isMe) ? '1px solid var(--border)' : 'none',
          boxShadow: 'var(--shadow-sm)',
          opacity: msg.pending ? 0.6 : 1,
        }}>
          {msg.is_deleted ? (
            <div style={{ fontSize: 13, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Ban size={14} aria-hidden /> {t('chat.messageDeleted')}
            </div>
          ) : (
            <>
              {msg.media_plain_url && msg.type === 'image' && (
                <img src={msg.media_plain_url} alt="" style={{ display: 'block', maxWidth: 260, width: '100%', borderRadius: 10, marginBottom: msg.content_plain ? 8 : 0 }} />
              )}
              {msg.content_plain && (
                <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.content_plain}</div>
              )}
              {/* A decrypted photo is just a photo (UAT: it also said "Encrypted
                  message"); the lock label is only for something that failed. */}
              {msg.content_encrypted && !msg.content_plain && !(msg.type === 'image' && msg.media_plain_url) && (
                <div style={{ fontSize: 13, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Lock size={13} aria-hidden /> {msg.type === 'image' ? t('chat.photoCouldNotDecrypt') : t('chat.encryptedMessageLabel')}
                </div>
              )}
            </>
          )}
        </div>
        {/* UI Law 2: a visible, always-tappable 44px trigger — deletion (and
            report) must be discoverable, never gesture-only. Long-press
            above still works as a shortcut. */}
        {hasActions && (
          <button ref={menuBtnRef} onClick={() => (showActions ? closeMenu() : openMenu())} aria-label={t('chat.messageActions')}
            style={{ width: 44, height: 44, minWidth: 44, flexShrink: 0, borderRadius: '50%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ellipsis size={18} aria-hidden />
          </button>
        )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, paddingLeft: 4, paddingRight: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text4)' }}>{timeStr}</span>
          {isMe && (
            <span style={{ fontSize: 11, color: allSeen ? 'var(--link)' : 'var(--text4)' }}>
              {msg.pending ? <Clock size={12} aria-label={t('chat.sendingAriaLabel')} style={{ verticalAlign: '-2px' }} /> : msg.failed ? <CircleAlert size={12} aria-label={t('chat.notSentAriaLabel')} style={{ verticalAlign: '-2px', color: 'var(--danger)' }} /> : allSeen ? '✓✓' : '✓'}
            </span>
          )}
        </div>
        {msg.failed && msg.failed_reason && (
          <button type="button" disabled={msg.type !== 'text'} onClick={() => msg.type === 'text' && onRetry(msg.id)}
            style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textAlign: 'left', fontSize: 10.5, color: 'var(--danger-strong)', paddingLeft: 4, paddingRight: 4, cursor: msg.type === 'text' ? 'pointer' : 'default' }}>
            {msg.failed_reason}
          </button>
        )}
      </div>
      {showReport && (
        <ReportModal targetType="message" targetId={msg.id} evidenceText={msg.content_plain || undefined} evidenceMedia={evidenceMedia} onClose={() => setShowReport(false)} />
      )}
    </motion.div>
    {/* Portaled to document.body, positioned via the trigger button's own
        on-screen rect (computed in openMenu) — escapes the message list's
        own scroll clipping and AppShell's sticky header (zIndex 40) rather
        than fighting them with a locally-anchored z-index. */}
    {showActions && menuPos && createPortal(
      <AnimatePresence>
        <div key="backdrop" onClick={closeMenu} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
        <motion.div key="menu" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, zIndex: 201, background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
          {confirmDeleteAll ? (
            // UI Law 2: one clear destructive confirmation — plain-language
            // copy naming the consequence, Cancel offered equally.
            <div style={{ padding: '12px 14px', width: 230 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 10, lineHeight: 1.4 }}>
                {t('chat.deleteForEveryoneConfirm')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={confirmDeleteForEveryone}
                  style={{ flex: 1, minHeight: 44, borderRadius: 8, background: 'var(--danger-fill)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Trash2 size={16} aria-hidden />{t('chat.delete')}
                </button>
                <button onClick={closeMenu} aria-label={t('chat.cancel')}
                  style={{ flex: 1, minHeight: 44, borderRadius: 8, background: 'var(--bg2)', color: 'var(--text4)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                  {t('chat.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {!isMe && (
                <button onClick={openReport}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 44, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  <Flag size={16} aria-hidden />{t('report.title')}
                </button>
              )}
              <button onClick={handleDeleteForMe} aria-label={t('chat.deleteForMe')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 44, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                <Trash2 size={16} aria-hidden />{t('chat.deleteForMe')}
              </button>
              {isMe && (
                <button onClick={handleDeleteForEveryoneClick} aria-label={t('chat.deleteForEveryone')}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', minHeight: 44, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--danger-strong)', whiteSpace: 'nowrap' }}>
                  <Trash2 size={16} aria-hidden />{t('chat.deleteForEveryone')}
                </button>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>,
      document.body
    )}
    </>
  )
}
