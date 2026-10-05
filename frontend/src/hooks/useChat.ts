// src/hooks/useChat.ts — WebSocket chat hook with E2E encryption
import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64, decodeUTF8 } from 'tweetnacl-util'
import {
  getEnsureE2EKeysPromise, getPinnedKey, pinKey, getHistoricalPrivateKeys, unlockLocalKeys, getPrivateKey,
  getCachedContactKeys, fetchAndCacheContactKeys, selectContactKeyCandidates,
  tryDecryptWithCandidates,
} from '../utils/e2e'
import { api } from '../utils/api'
import { clearVerified } from '../utils/safetyNumber'
import { compressImage } from '../utils/mediaCompress'
import toast from 'react-hot-toast'

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || 'wss://chat.spandik.com'
const API_URL = import.meta.env.VITE_API_URL || 'https://api.spandik.com'

interface ChatMessage {
  id: string
  thread_id: string
  sender_id: string
  sender_username: string
  sender_name: string
  sender_pic: string | null
  type: 'text' | 'image' | 'audio'
  content_plain: string | null
  content_encrypted: string | null
  nonce: string | null
  key_version?: number
  sender_current_key_version?: number
  media_url: string | null
  media_plain_url?: string | null
  // SP-15-17: the actual decrypted Blob backing media_plain_url — kept
  // alongside the object-URL string so message-media reporting can read
  // the real bytes via blob.arrayBuffer() (a plain in-memory read, no
  // network semantics). Re-fetching media_plain_url instead would violate
  // this app's own CSP (connect-src has no blob: entry, by design — a page
  // fetching its own blob: URLs isn't a real network request and normally
  // has no reason to need one).
  media_plain_blob?: Blob | null
  media_mime?: string | null
  reply_to_id: string | null
  seen_by: string[]
  created_at: string
  pending?: boolean
  failed?: boolean
  failed_reason?: string
  // SP-3-03: delete-for-everyone tombstone — set locally the instant the
  // initiating REST call succeeds, or on receiving a valid `message_deleted`
  // WS event, or when the server already returns a sanitized tombstone row
  // (history reload/reconnect catch-up). No content/media field is trusted
  // once this is true.
  is_deleted?: boolean
}

interface TypingUser {
  user_id: string
  username: string
  is_typing: boolean
}

// ── WebSocket protocol types ────────────────────────────────────
// SP-1-12: server -> client push events. `event` is the discriminator —
// deliberately never `type`, which on a chat message means its own content
// kind (text/image/audio); a nested message payload has its own `type`
// field for exactly that. See chat-worker/src/index.ts's pushMessage for
// the send side (a real bug — the two `type` fields used to collide via
// object-spread order, silently breaking live push entirely — was found
// and fixed alongside this typing pass).
interface WSNewMessageEvent { event: 'new_message'; message: ChatMessage }
interface WSTypingEvent { event: 'typing'; user_id: string; username: string; is_typing: boolean }
// SP-3-04: one batch receipt per mark-seen operation — `up_to_message_id`
// is the boundary (the last message the API's own snapshot considered
// unread at call time), not a single message id. Replaces the old
// per-message `message_id` shape (see git history) now that nothing
// client-side sends an individual message_seen WS command anymore.
interface WSMessageSeenEvent { event: 'message_seen'; thread_id: string; up_to_message_id: string; seen_by: string }
interface WSUserOfflineEvent { event: 'user_offline'; user_id: string; username: string }
// SP-3-03: pushed on delete-for-everyone (see api's chat.ts DELETE route +
// chat-worker's dedicated /internal/.../message-deleted push). Deliberately
// carries no ciphertext/nonce/media — just enough for an already-open
// thread to tombstone the message locally.
interface WSMessageDeletedEvent {
  event: 'message_deleted'
  thread_id: string
  message_id: string
  for_everyone: true
  deleted_at: string
}
type WSInboundEvent = WSNewMessageEvent | WSTypingEvent | WSMessageSeenEvent | WSUserOfflineEvent | WSMessageDeletedEvent

// Runtime validation for the one inbound event this task adds — a bare
// `as WSInboundEvent` cast (the pre-existing pattern for the other event
// types) is not enough for something a malicious/buggy peer could shape
// arbitrarily; a malformed or wrong-thread event must be safely ignored,
// never partially applied.
export function isValidDeletionEvent(m: any, threadId: string | undefined): m is WSMessageDeletedEvent {
  return !!m && m.event === 'message_deleted'
    && typeof m.thread_id === 'string' && m.thread_id.length > 0 && m.thread_id.length <= 64
    && m.thread_id === threadId
    && typeof m.message_id === 'string' && m.message_id.length > 0 && m.message_id.length <= 64
    && m.for_everyone === true
    && typeof m.deleted_at === 'string' && m.deleted_at.length > 0 && m.deleted_at.length <= 64
}

// SP-3-04: runtime validation for the batch seen receipt — same reasoning
// as isValidDeletionEvent above, never trust a bare `as WSInboundEvent` cast.
export function isValidSeenEvent(m: any, threadId: string | undefined): m is WSMessageSeenEvent {
  return !!m && m.event === 'message_seen'
    && typeof m.thread_id === 'string' && m.thread_id.length > 0 && m.thread_id.length <= 64
    && m.thread_id === threadId
    && typeof m.up_to_message_id === 'string' && m.up_to_message_id.length > 0 && m.up_to_message_id.length <= 64
    && typeof m.seen_by === 'string' && m.seen_by.length > 0 && m.seen_by.length <= 64
}

// Applies a batch seen receipt: every message AT OR BEFORE `up_to_message_id`
// in chronological order (array index — `messages` is always maintained
// oldest-first) that this account itself sent gets `seen_by` extended with
// the marking user. Only ever adds to seen_by, never removes — applying an
// older/delayed receipt after a newer one has already landed is therefore
// always a safe no-op (monotonic), never a regression. If the boundary
// message isn't currently loaded locally (e.g. far scrolled-back history),
// this is a harmless no-op — the durable D1 state is unaffected and a
// reload/history fetch will show the correct state regardless.
export function applySeenReceipt(messages: ChatMessage[], event: WSMessageSeenEvent, myUserId: string | undefined): ChatMessage[] {
  const boundaryIdx = messages.findIndex(m => m.id === event.up_to_message_id)
  if (boundaryIdx === -1) return messages
  return messages.map((m, i) => (i <= boundaryIdx && m.sender_id === myUserId)
    ? { ...m, seen_by: [...new Set([...m.seen_by, event.seen_by])] }
    : m)
}

// Strips every content/media field a tombstone must never carry, revoking
// the blob object URL first (SP-3-03 requirement: no dangling object URL).
// Resolves a just-sent optimistic message once the server confirms it. A
// race is possible where this same message's own `new_message` WS push
// (see ws.onmessage below) already appended it under its real server id
// before this REST response arrives — naively replacing the tempId row in
// place would then leave two rows for the same message (the old tempId row
// now also carrying the real id, plus the WS-inserted one). Drop the
// now-redundant optimistic row instead of creating a second copy.
export function resolveOptimisticSend(prev: ChatMessage[], tempId: string, serverMsg: ChatMessage): ChatMessage[] {
  if (prev.some(m => m.id === serverMsg.id && m.id !== tempId)) {
    return prev.filter(m => m.id !== tempId)
  }
  return prev.map(m => (m.id === tempId ? serverMsg : m))
}

export function tombstone(msg: ChatMessage): ChatMessage {
  if (msg.media_plain_url) { try { URL.revokeObjectURL(msg.media_plain_url) } catch {} }
  return {
    ...msg, is_deleted: true, pending: false, failed: false,
    content_plain: null, content_encrypted: null, nonce: null,
    media_url: null, media_plain_url: null, media_plain_blob: null, media_mime: null,
  }
}

// Client -> server commands (unaffected by the event/type rename above —
// chat-worker's incoming webSocketMessage handler still keys on `type`,
// and these are simple flat commands with no nested payload to collide).
// SP-3-04: the old per-message `message_seen` command is gone — marking
// seen is now exclusively the server-driven batch POST /threads/:id/seen
// path (see markThreadSeen below), never a client-originated WS command.
type WSOutboundCommand =
  | { type: 'ping' }
  | { type: 'typing'; is_typing: boolean }

// ── REST API response shapes ────────────────────────────────────
// Matches the backend's ok()/badRequest()/etc. response envelope
// (api/src/utils/index.ts) — only the fields this hook actually reads.
interface ApiEnvelope<T> { ok: boolean; data?: T; error?: string; message?: string }
interface ThreadInfo {
  other_user: { id: string } | null
  request_status?: string
  is_sender?: boolean
}
interface UploadResult { key: string }
interface PublicKeyResult { public_key: string | null }

// E2E key cache with 10-minute TTL
const pubKeyCache: Record<string, { key: Uint8Array; ts: number }> = {}
const PUB_KEY_TTL = 10 * 60 * 1000

async function getRecipientPublicKey(userId: string, accessToken: string): Promise<Uint8Array | null> {
  const cached = pubKeyCache[userId]
  if (cached && Date.now() - cached.ts < PUB_KEY_TTL) return cached.key

  // SP-1-06: retry only TRANSIENT failures (network error, non-ok response) —
  // a clean response saying the recipient genuinely has no key isn't
  // something retrying fixes, so that returns immediately instead of
  // wasting the retry budget (and delaying the "no key" UI state).
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)))
    try {
      const res = await api.get<ApiEnvelope<PublicKeyResult>>(`/users/${userId}/e2e-key`)
      const data = res.data
      if (!data.ok) continue
      if (!data.data?.public_key) return null
      const key = decodeBase64(data.data.public_key)
      pubKeyCache[userId] = { key, ts: Date.now() }
      return key
    } catch { /* network error — retry */ }
  }
  return null
}

function encryptMessage(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array
): { encrypted: string; nonce: string } | null {
  try {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const box = nacl.box(decodeUTF8(plaintext), nonce, recipientPublicKey, senderPrivateKey)
    if (!box) return null
    return { encrypted: encodeBase64(box), nonce: encodeBase64(nonce) }
  } catch { return null }
}

function decryptMessage(
  encryptedB64: string,
  nonceB64: string,
  senderPublicKey: Uint8Array,
  myPrivateKey: Uint8Array
): string | null {
  try {
    const opened = nacl.box.open(
      decodeBase64(encryptedB64),
      decodeBase64(nonceB64),
      senderPublicKey,
      myPrivateKey
    )
    if (!opened) return null
    return new TextDecoder().decode(opened)
  } catch { return null }
}

// Ticket mint failed: null = permanent refusal for this thread (403 declined
// request, 404 not a member / blocked) — never retry, it only spams ticket
// requests; otherwise the same capped backoff a dropped socket uses (each
// retry mints a fresh single-use ticket — a ticket is never reused).
export function chatTicketRetryDelay(status: number | undefined, attempt: number): number | null {
  if (status === 403 || status === 404) return null
  return Math.min(1000 * Math.pow(2, attempt), 30000)
}

function encryptBytes(bytes: Uint8Array, key: Uint8Array): { encrypted: Uint8Array; nonce: string } | null {
  try {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const box = nacl.secretbox(bytes, nonce, key)
    return { encrypted: box, nonce: encodeBase64(nonce) }
  } catch { return null }
}

function decryptBytes(encrypted: ArrayBuffer, nonceB64: string, keyB64: string): Uint8Array | null {
  try {
    return nacl.secretbox.open(new Uint8Array(encrypted), decodeBase64(nonceB64), decodeBase64(keyB64))
  } catch { return null }
}

function sendWS(ws: WebSocket, cmd: WSOutboundCommand): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd))
}

// Option B: the key is wrapped at rest — unlock (once per page load) first.
async function getMyPrivateKey(userId: string): Promise<Uint8Array | null> {
  await unlockLocalKeys(userId)
  return getPrivateKey(userId)
}


export function useChat(threadId: string | undefined) {
  const user        = useAuthStore(s => s.user)
  const accessToken = useAuthStore(s => s.accessToken)
  const qc          = useQueryClient()
  const wsRef       = useRef<WebSocket | null>(null)
  const pingRef     = useRef<ReturnType<typeof setInterval>>()
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>()
  const reconnectAttempts = useRef(0)
  const recipientIdRef = useRef<string | null>(null)
  const recipientLookupRef = useRef<Promise<string | null> | null>(null)
  // SP-2-01: tracks the newest message's created_at so a WS reconnect can
  // do a single "what did I miss" catch-up fetch instead of the poll doing
  // the work continuously.
  const lastMessageTimeRef = useRef<string | null>(null)
  // SP-3-03: bounded guard against a delete-for-everyone event arriving
  // before a delayed `new_message`/poll re-add of the same message — insertion
  // paths below check this before adding a message, not just the deletion
  // handler. FIFO-bounded (not a `Set` that grows forever across a long
  // session).
  const deletedIdsRef = useRef<string[]>([])
  function markDeletedLocally(id: string) {
    if (!deletedIdsRef.current.includes(id)) deletedIdsRef.current.push(id)
    if (deletedIdsRef.current.length > 500) deletedIdsRef.current.shift()
  }

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping]     = useState<TypingUser[]>([])
  const [connected, setConnected] = useState(false)
  // Whether this room's socket has opened at least once — the room says
  // "Reconnecting…" only for a real drop, not during the first connect (UAT).
  const everConnected = useRef(false)
  const [loading, setLoading]   = useState(true)
  const [hasMore, setHasMore]   = useState(false)
  const [recipientHasKey, setRecipientHasKey] = useState<boolean | null>(null)
  const [requestStatus, setRequestStatus] = useState<string | null>(null)
  const [isSender, setIsSender] = useState<boolean>(false)
  // SP-1-08: set when the recipient's key no longer matches what this device
  // pinned on first contact — blocks sending until explicitly accepted.
  const [keyChangeWarning, setKeyChangeWarning] = useState<{ contactId: string; newKeyB64: string } | null>(null)

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last) lastMessageTimeRef.current = last.created_at
  }, [messages])

  // Decrypts and appends a freshly-fetched batch (poll or reconnect
  // catch-up), deduped against whatever's already in state. Callers pass
  // messages already in chronological (oldest-first) order.
  const mergeNewMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages(prev => {
      const prevIds = new Set(prev.map(m => m.id))
      // SP-3-03: never resurrect a message this client already tombstoned
      // locally — a delayed poll/reconnect-catchup response for the same id
      // must not re-insert live content.
      const newMsgs = incoming.filter(m => !prevIds.has(m.id) && !deletedIdsRef.current.includes(m.id))
      if (newMsgs.length === 0) return prev
      Promise.all(newMsgs.map(m => tryDecrypt(m))).then(decrypted => {
        setMessages(p => {
          const ids = new Set(p.map(x => x.id))
          const fresh = decrypted.filter(m => !ids.has(m.id))
          if (fresh.length === 0) return p
          qc.invalidateQueries({ queryKey: ['chat-threads'] })
          qc.invalidateQueries({ queryKey: ['chat-threads-badge'] })
          return [...p, ...fresh]
        })
      })
      return prev
    })
  }, [qc])

  // Single-flight: tryDecrypt may call this for a whole history page at once.
  function ensureRecipientId(): Promise<string | null> {
    if (recipientIdRef.current) return Promise.resolve(recipientIdRef.current)
    if (!recipientLookupRef.current) {
      recipientLookupRef.current = lookupRecipientId().finally(() => { recipientLookupRef.current = null })
    }
    return recipientLookupRef.current
  }

  async function lookupRecipientId(): Promise<string | null> {
    if (!threadId) return null
    try {
      const res = await api.get<ApiEnvelope<ThreadInfo>>(`/chat/threads/${threadId}`)
      const info = res.data?.data
      const otherId = info?.other_user?.id || null
      if (otherId && info) {
        recipientIdRef.current = otherId
        setRequestStatus(info.request_status || 'accepted')
        setIsSender(!!info.is_sender)
      }
      return otherId
    } catch {
      return null
    }
  }

  // Decrypt a message.
  // KEY INSIGHT: In a 2-person thread, ALWAYS use the other person's public key.
  // NaCl box DH: shared_secret = DH(myPriv, theirPub) is symmetric —
  //   sender:    encrypted with DH(senderPriv, recipPub)
  //   recipient: decrypts with DH(recipPriv, senderPub) = same secret ✓
  //   sender re-reading: decrypts with DH(senderPriv, recipPub) = same secret ✓
  // So "other person's pub key + my priv key" always works for both sides.
  // SP-0-05: if the sender has since rotated their identity key, a message encrypted
  // under their old key will fail to decrypt with their current public key — tell the
  // user why instead of a generic failure.
  function decryptFailedLabel(msg: ChatMessage): string {
    if (msg.key_version && msg.sender_current_key_version && msg.key_version < msg.sender_current_key_version) {
      return '🔒 Sent with a previous key'
    }
    return '🔒 Decryption failed'
  }

  async function tryDecrypt(msg: ChatMessage): Promise<ChatMessage> {
    if (!msg.content_encrypted || !user) return msg
    // No nonce = message predates encryption enforcement (SP-0-02) — never render ciphertext as text.
    if (!msg.nonce) return { ...msg, content_plain: '🔒 Message from an old version' }
    const ciphertext = msg.content_encrypted
    const nonce = msg.nonce
    const myPrivKey = await getMyPrivateKey(user.id)
    if (!myPrivKey) return { ...msg, content_plain: '🔒 Encrypted message' }
    try {
      // Wave 3A step 9 (found by spec 51): the thread-info fetch that sets
      // the recipient can fail transiently, or a live message can arrive
      // before it finishes — both used to leave every message showing
      // "Encrypted message" for good. Look the recipient up on demand.
      const otherId = recipientIdRef.current || await ensureRecipientId()
      if (!otherId) return { ...msg, content_plain: '🔒 Encrypted message' }
      const otherPubKey = await getRecipientPublicKey(otherId, accessToken || '')
      if (!otherPubKey) return { ...msg, content_plain: '🔒 Unable to decrypt' }
      observeContactKey(otherId, otherPubKey)
      const myHistoricalKeys = getHistoricalPrivateKeys(user.id)
      let plain = decryptMessage(ciphertext, nonce, otherPubKey, myPrivKey)
      if (!plain) {
        // SP-1-09: my current key didn't open it — this account may have
        // rotated its OWN key since this message was sent to it. Try each
        // of my previous key versions (cached on restore) before giving up.
        for (const h of myHistoricalKeys) {
          plain = decryptMessage(ciphertext, nonce, otherPubKey, h.private_key)
          if (plain) break
        }
      }
      if (!plain) {
        // SP-1-11: neither my current nor my historical keys opened it
        // against the CONTACT's current key — the contact may have rotated
        // since this ciphertext was created (the gap SP-1-09 didn't cover).
        // msg.key_version names the exact version to try first when the
        // contact is this message's sender (the fast, common case); try the
        // locally cached history first (no network round-trip on the
        // common "already fetched this thread's rotations before" path),
        // then fetch fresh only if that still doesn't open it. The actual
        // candidate-pair ordering is the pure, unit-tested
        // tryDecryptWithCandidates (see e2e.test.ts).
        const myKeys = [myPrivKey, ...myHistoricalKeys.map(h => h.private_key)]
        const targetVersion = msg.sender_id === otherId ? msg.key_version : undefined
        const decryptWith = (otherKey: Uint8Array, myKey: Uint8Array) => decryptMessage(ciphertext, nonce, otherKey, myKey)
        const tryContactKeys = (contactKeys: ReturnType<typeof getCachedContactKeys>) =>
          tryDecryptWithCandidates(decryptWith, selectContactKeyCandidates(contactKeys, targetVersion), myKeys)
        plain = tryContactKeys(getCachedContactKeys(user.id, otherId))
        if (!plain) {
          const fetched = await fetchAndCacheContactKeys(user.id, otherId, accessToken || '')
          plain = tryContactKeys(fetched)
        }
      }
      if (!plain) return { ...msg, content_plain: decryptFailedLabel(msg) }

      if (msg.type === 'image' && msg.media_url) {
        try {
          const meta = JSON.parse(plain)
          // Chat media is served only through the authenticated /media/serve/* route (SP-0-04).
          const mediaRes = await fetch(msg.media_url, { headers: { Authorization: `Bearer ${accessToken}` } })
          const encryptedBytes = await mediaRes.arrayBuffer()
          const opened = decryptBytes(encryptedBytes, meta.file_nonce, meta.file_key)
          if (!opened) return { ...msg, content_plain: '🔒 Image decryption failed' }
          const blob = new Blob([opened as BlobPart], { type: meta.mime || 'image/jpeg' })
          return {
            ...msg,
            content_plain: meta.caption || '',
            media_plain_url: URL.createObjectURL(blob),
            media_plain_blob: blob,
            media_mime: meta.mime || 'image/jpeg',
          }
        } catch {
          return { ...msg, content_plain: '🔒 Image decryption failed' }
        }
      }

      return { ...msg, content_plain: plain }
    } catch {
      return { ...msg, content_plain: decryptFailedLabel(msg) }
    }
  }

  // Load initial messages — sequential: restore keys → thread info → messages
  useEffect(() => {
    if (!threadId || !accessToken) return
    setLoading(true)
    ;(async () => {
      try {
        // 1. Wait for ensureE2EKeys (called at login) to complete, then restore
        await Promise.race([
          getEnsureE2EKeysPromise(),
          new Promise<void>(r => setTimeout(r, 4000))
        ])

        // SP-1-03: no more silent plain-key restore here — if the key is still
        // missing at this point, the account has an encrypted backup PinModal
        // is responsible for unlocking (app-wide), not this hook. Proceeding
        // regardless; tryDecrypt already renders a graceful fallback for a
        // missing key instead of failing the whole thread load.

        // 2. Get thread info first — must know recipient ID before decrypting
        const tr = await fetch(`${API_URL}/chat/threads/${threadId}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        const td = await tr.json() as ApiEnvelope<ThreadInfo>
        if (td.ok && td.data?.other_user) {
          recipientIdRef.current = td.data.other_user.id
          setRequestStatus(td.data.request_status || 'accepted')
          setIsSender(!!td.data.is_sender)
          // Check if recipient has a public key so UI can show appropriate state
          const recipKey = await getRecipientPublicKey(td.data.other_user.id, accessToken || '')
          setRecipientHasKey(!!recipKey)
        }

        // 3. Load messages — recipient ID is now set, decryption will work correctly
        const mr = await fetch(`${API_URL}/chat/threads/${threadId}/messages?limit=40`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        const data = await mr.json() as ApiEnvelope<ChatMessage[]>
        if (data.ok) {
          const msgs = (data.data || []).reverse()
          const decrypted = await Promise.all(msgs.map(m => tryDecrypt(m)))
          setMessages(decrypted)
          setHasMore((data.data?.length || 0) === 40)
        }
      } catch {}
      setLoading(false)
    })()
  }, [threadId, accessToken])

  // WebSocket
  useEffect(() => {
    if (!threadId || !accessToken) return
    // SP-2-11: mint a short-lived (60s), single-use ticket instead of
    // putting the long-lived access token directly in the WS URL — a
    // token there leaks into browser history and proxy/edge logs on every
    // single connect and reconnect. `connect` runs on both the initial
    // mount and every reconnect (via ws.onclose below), so this one
    // change covers both per SP-2-11's acceptance criterion.
    // UAT: closing the socket in cleanup fires onclose AFTER the timer was
    // cleared, so a stale effect kept reconnecting (and minting tickets) next
    // to the new one. Once disposed, this effect never reconnects again.
    let disposed = false
    everConnected.current = false // a new room / token-refresh reconnect is not a "drop"
    async function connect() {
      if (disposed) return
      let ticket: string
      try {
        const res = await api.post<ApiEnvelope<{ ticket: string }>>(`/chat/threads/${threadId}/ws-ticket`)
        if (!res.data.ok || !res.data.data?.ticket) throw new Error('no ticket')
        ticket = res.data.data.ticket
      } catch (err: any) {
        if (disposed) return
        const delay = chatTicketRetryDelay(err?.response?.status, reconnectAttempts.current)
        if (delay === null) return
        reconnectAttempts.current++
        reconnectRef.current = setTimeout(connect, delay)
        return
      }
      if (disposed) return
      const ws = new WebSocket(`${CHAT_WS_URL}/chat/thread/${threadId}?ticket=${ticket}`)
      wsRef.current = ws
      ws.onopen = () => {
        everConnected.current = true
        // SP-2-01: a single catch-up fetch for whatever landed while
        // disconnected replaces the old poll's job of covering that gap.
        setConnected(true)
        reconnectAttempts.current = 0
        pingRef.current = setInterval(() => sendWS(ws, { type: 'ping' }), 30000)
        // Wave 3A step 4 (found in the production proof): the FIRST open
        // needs the catch-up too — a message stored after the initial
        // history load but before this socket opened was neither in that
        // load nor pushed here, so it stayed invisible until a reload.
        // mergeNewMessages dedups, so an empty/overlapping result is free.
        if (threadId && lastMessageTimeRef.current) {
          // The `after` query returns chronological (ASC) order already —
          // ready to merge as-is, unlike the plain listing endpoint below.
          api.get<ApiEnvelope<ChatMessage[]>>(`/chat/threads/${threadId}/messages?after=${encodeURIComponent(lastMessageTimeRef.current)}&limit=100`)
            .then(res => { if (res.data.ok && res.data.data) mergeNewMessages(res.data.data) })
            .catch(() => {})
        }
      }
      ws.onmessage = async (event) => {
        try {
          const raw = JSON.parse(event.data)
          if (raw?.event === 'new_message') {
            const msg = raw as WSNewMessageEvent
            // SP-3-03: a race where this arrives after the peer's deletion
            // event already tombstoned the same id — never resurrect it.
            if (deletedIdsRef.current.includes(msg.message.id)) return
            const decrypted = await tryDecrypt(msg.message)
            setMessages(prev => {
              if (prev.find(m => m.id === decrypted.id)) return prev
              return [...prev, decrypted]
            })
            // Refresh thread list so last message + unread count update
            qc.invalidateQueries({ queryKey: ['chat-threads'] })
            qc.invalidateQueries({ queryKey: ['chat-threads-badge'] })
          } else if (raw?.event === 'message_deleted') {
            if (!isValidDeletionEvent(raw, threadId)) return
            markDeletedLocally(raw.message_id)
            setMessages(prev => prev.some(m => m.id === raw.message_id) ? prev.map(m => m.id === raw.message_id ? tombstone(m) : m) : prev)
            qc.invalidateQueries({ queryKey: ['chat-threads'] })
            qc.invalidateQueries({ queryKey: ['chat-threads-badge'] })
          } else if (raw?.event === 'message_seen') {
            if (!isValidSeenEvent(raw, threadId)) return
            setMessages(prev => applySeenReceipt(prev, raw, user?.id))
          } else {
            handleMessage(raw as Exclude<WSInboundEvent, WSNewMessageEvent | WSMessageDeletedEvent | WSMessageSeenEvent>)
          }
        } catch {}
      }
      ws.onclose = () => {
        setConnected(false)
        clearInterval(pingRef.current)
        if (disposed) return
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectAttempts.current++
        reconnectRef.current = setTimeout(connect, delay)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      disposed = true
      wsRef.current?.close()
      clearInterval(pingRef.current)
      clearTimeout(reconnectRef.current)
    }
  }, [threadId, accessToken])

  function handleMessage(msg: Exclude<WSInboundEvent, WSNewMessageEvent | WSMessageDeletedEvent | WSMessageSeenEvent>) {
    switch (msg.event) {
      case 'typing':
        setTyping(prev => {
          const filtered = prev.filter(t => t.user_id !== msg.user_id)
          if (msg.is_typing && msg.user_id !== user?.id) return [...filtered, { user_id: msg.user_id, username: msg.username, is_typing: true }]
          return filtered
        })
        setTimeout(() => setTyping(prev => prev.filter(t => t.user_id !== msg.user_id)), 4000)
        break
      case 'user_offline':
        setTyping(prev => prev.filter(t => t.user_id !== msg.user_id))
        break
    }
  }

  // SP-1-08: TOFU pinning check, called right before encrypting to a
  // contact. First-ever contact pins the key silently (nothing to warn
  // about yet). A later mismatch blocks sending and raises the warning —
  // never silently re-pin here, only acceptKeyChange() does that.
  // Wave 3A step 4: the RECEIVE path checks the pin too. Before, only
  // sending did — a server substituting a contact's key could have shown
  // messages "from" that contact with no warning until the user replied.
  // Messages still display; the same key-changed banner appears at once, and
  // sending stays blocked (checkKeyPin) until the user accepts. First sight
  // pins (trust on first use: the FIRST key itself is not authenticated —
  // that is SP-14-03's safety-number work).
  function observeContactKey(contactId: string, key: Uint8Array): void {
    if (!user) return
    const current = encodeBase64(key)
    const pinned = getPinnedKey(user.id, contactId)
    if (!pinned) { pinKey(user.id, contactId, current); return }
    if (pinned !== current) {
      clearVerified(user.id, contactId) // SP-14-03: a changed key is never "verified"
      setKeyChangeWarning(prev => (prev?.newKeyB64 === current ? prev : { contactId, newKeyB64: current }))
    }
  }

  function checkKeyPin(contactId: string, recipPubKey: Uint8Array): boolean {
    if (!user) return false
    const currentB64 = encodeBase64(recipPubKey)
    const pinned = getPinnedKey(user.id, contactId)
    if (!pinned) { pinKey(user.id, contactId, currentB64); return true }
    if (pinned !== currentB64) { clearVerified(user.id, contactId); setKeyChangeWarning({ contactId, newKeyB64: currentB64 }); return false }
    return true
  }

  const acceptKeyChange = useCallback(() => {
    if (!keyChangeWarning || !user) return
    pinKey(user.id, keyChangeWarning.contactId, keyChangeWarning.newKeyB64)
    // SP-14-03: already cleared when the change was detected; a new key must
    // be verified again from scratch.
    clearVerified(user.id, keyChangeWarning.contactId)
    setKeyChangeWarning(null)
  }, [keyChangeWarning, user])

  const sendMessage = useCallback(async (content: string, type: ChatMessage['type'] = 'text') => {
    if (!content.trim() || !threadId || !user || !accessToken) return

    const tempId = `temp_${Date.now()}`
    const optimistic: ChatMessage = {
      id: tempId, thread_id: threadId,
      sender_id: user.id, sender_username: user.username || '',
      sender_name: `${user.first_name} ${user.last_name}`,
      sender_pic: user.profile_pic_url || null,
      type, content_plain: content,
      content_encrypted: null, nonce: null,
      media_url: null, reply_to_id: null,
      seen_by: [], created_at: new Date().toISOString(), pending: true,
    }
    setMessages(prev => [...prev, optimistic])

    const fail = (reason = 'Send failed') => setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true, failed_reason: reason } : m))

    // Must know recipient before encrypting
    const recipientId = await ensureRecipientId()
    if (!recipientId) { fail('Could not load recipient'); return }

    // Get my private key — App.tsx ensureE2EKeys / PinModal should have set this up
    const myPrivKey = await getMyPrivateKey(user.id)
    if (!myPrivKey) { fail('Chat key not restored'); return }

    // Get recipient's public key
    const recipPubKey = await getRecipientPublicKey(recipientId, accessToken)
    if (!recipPubKey) { setRecipientHasKey(false); fail("Couldn't send — tap to retry"); return }
    setRecipientHasKey(true)
    if (!checkKeyPin(recipientId, recipPubKey)) { fail('Security key changed — verify before sending'); return }

    // Encrypt
    const result = encryptMessage(content, recipPubKey, myPrivKey)
    if (!result) { fail('Encryption failed'); return }

    // Send to API
    api.post<ApiEnvelope<ChatMessage>>(`/chat/threads/${threadId}/messages`, { content_encrypted: result.encrypted, nonce: result.nonce, type })
      .then(data => {
        if (data.data?.ok && data.data.data) {
          const serverMsg = { ...(data.data.data as ChatMessage), content_plain: content, pending: false }
          setMessages(prev => resolveOptimisticSend(prev, tempId, serverMsg))
        } else {
          fail(data.data?.error || 'Send failed')
        }
      })
      .catch((err: AxiosError<ApiEnvelope<never>>) => fail(err.response?.data?.error || 'Send failed'))
  }, [threadId, accessToken, user])

  const sendImage = useCallback(async (rawFile: File) => {
    if (!threadId || !user || !accessToken) return
    if (!rawFile.type.startsWith('image/')) return
    if (rawFile.size > 10 * 1024 * 1024) return

    // SP-2-15: compression runs BEFORE encryption, on the sender's device —
    // never server-side, never after. The compressed file (not the
    // original) is what gets encrypted, previewed, and recorded in the
    // encrypted metadata below, so the recipient decrypts exactly what was
    // actually sent.
    let file: File
    try {
      const r = await compressImage(rawFile)
      file = r.file
    } catch {
      file = rawFile // compression failure (e.g. HEIC) still lets the original through here — sendImage's own type/size guards above already ran
    }

    const tempId = `temp_img_${Date.now()}`
    const localUrl = URL.createObjectURL(file)
    const optimistic: ChatMessage = {
      id: tempId, thread_id: threadId,
      sender_id: user.id, sender_username: user.username || '',
      sender_name: `${user.first_name} ${user.last_name}`,
      sender_pic: user.profile_pic_url || null,
      type: 'image', content_plain: '',
      content_encrypted: null, nonce: null,
      media_url: null, media_plain_url: localUrl, media_plain_blob: file, media_mime: file.type,
      reply_to_id: null, seen_by: [], created_at: new Date().toISOString(), pending: true,
    }
    setMessages(prev => [...prev, optimistic])

    const fail = (reason = 'Send failed') => setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, failed: true, failed_reason: reason } : m))

    const recipientId = await ensureRecipientId()
    if (!recipientId) { fail('Could not load recipient'); return }
    const myPrivKey = await getMyPrivateKey(user.id)
    if (!myPrivKey) { fail('Chat key not restored'); return }
    const recipPubKey = await getRecipientPublicKey(recipientId, accessToken)
    if (!recipPubKey) { setRecipientHasKey(false); fail("Couldn't send — tap to retry"); return }
    if (!checkKeyPin(recipientId, recipPubKey)) { fail('Security key changed — verify before sending'); return }

    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const fileKey = nacl.randomBytes(nacl.secretbox.keyLength)
    const encryptedFile = encryptBytes(fileBytes, fileKey)
    if (!encryptedFile) { fail('Image encryption failed'); return }

    const encryptedBlob = new Blob([encryptedFile.encrypted as BlobPart], { type: file.type })
    const encryptedUpload = new File([encryptedBlob], file.name, { type: file.type })
    const form = new FormData()
    form.append('file', encryptedUpload)
    form.append('purpose', 'chat')
    form.append('thread_id', threadId)

    let mediaKey: string | null = null
    try {
      const uploadRes = await api.post<ApiEnvelope<UploadResult>>('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      mediaKey = uploadRes.data?.data?.key || null
    } catch {}
    if (!mediaKey) { fail('Image upload failed'); return }

    const meta = JSON.stringify({
      file_key: encodeBase64(fileKey),
      file_nonce: encryptedFile.nonce,
      mime: file.type,
      name: file.name,
      size: file.size,
    })
    const encryptedMeta = encryptMessage(meta, recipPubKey, myPrivKey)
    if (!encryptedMeta) { fail('Image metadata encryption failed'); return }

    api.post<ApiEnvelope<ChatMessage>>(`/chat/threads/${threadId}/messages`, {
        type: 'image',
        content_encrypted: encryptedMeta.encrypted,
        nonce: encryptedMeta.nonce,
        media_key: mediaKey,
    })
      .then(data => {
        if (data.data?.ok && data.data.data) {
          const serverMsg = {
            ...(data.data.data as ChatMessage),
            content_plain: '',
            media_plain_url: localUrl,
            media_plain_blob: file,
            media_mime: file.type,
            pending: false,
          }
          setMessages(prev => resolveOptimisticSend(prev, tempId, serverMsg))
        } else {
          fail(data.data?.error || 'Send failed')
        }
      })
      .catch((err: AxiosError<ApiEnvelope<never>>) => fail(err.response?.data?.error || 'Send failed'))
  }, [threadId, accessToken, user])

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current) sendWS(wsRef.current, { type: 'typing', is_typing: isTyping })
  }, [])

  // SP-3-03: delete-for-me removes the row from this device's view only, no
  // push. Delete-for-everyone updates local state immediately on REST
  // success rather than waiting for this device's own WS echo (which also
  // arrives, harmlessly idempotent via the deletedIdsRef guard above).
  const deleteMessage = useCallback(async (messageId: string, forEveryone: boolean) => {
    if (!threadId) return
    try {
      await api.delete(`/chat/threads/${threadId}/messages/${messageId}`, { data: { for_everyone: forEveryone } })
      if (forEveryone) {
        markDeletedLocally(messageId)
        setMessages(prev => prev.map(m => m.id === messageId ? tombstone(m) : m))
        qc.invalidateQueries({ queryKey: ['chat-threads'] })
        qc.invalidateQueries({ queryKey: ['chat-threads-badge'] })
      } else {
        setMessages(prev => prev.filter(m => m.id !== messageId))
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Couldn't delete — try again")
    }
  }, [threadId, qc])

  // SP-3-04: canonical batch mark-seen. Calls POST /threads/:id/seen once —
  // the server durably marks every currently-unread message in one D1
  // write and pushes exactly one batch WS receipt (see ws.onmessage's
  // message_seen branch above), which is what now drives the sender's live
  // ✓✓ update; this call itself is idempotent and safe to fire on every
  // messages-list change (a double-text, a slow WS connect on first
  // render, or simply reopening an already-read thread all self-heal
  // through the same durable path, same reasoning the old /read endpoint
  // already established — see git history for that original bug writeup).
  // The unread badge/thread-list zero out via a direct local cache write
  // instead of an invalidate-triggered refetch, so it clears instantly
  // rather than after a network round-trip.
  const markThreadSeen = useCallback(() => {
    if (!threadId) return
    const hasUnread = messages.some(m => m.sender_id !== user?.id && !m.seen_by?.includes(user?.id || ''))
    if (!hasUnread) return
    api.post(`/chat/threads/${threadId}/seen`).then(() => {
      qc.setQueryData<any[]>(['chat-threads'], prev =>
        prev?.map(t => (t.id === threadId ? { ...t, unread_count: 0 } : t)))
      qc.setQueryData<{ ok: boolean; data: any[] }>(['chat-threads-badge'], prev =>
        prev ? { ...prev, data: prev.data.map(t => (t.id === threadId ? { ...t, unread_count: 0 } : t)) } : prev)
    }).catch(() => {})
  }, [threadId, messages, user?.id, qc])

  // SP-2-02: keyset cursor (the oldest currently-loaded message's id) — was
  // page-number offset, which skips or repeats messages if new ones arrive
  // in this thread while scrolling back through history.
  const loadMore = useCallback(async () => {
    if (!threadId || !hasMore || messages.length === 0) return
    const oldestId = messages[0].id
    const res = await fetch(`${API_URL}/chat/threads/${threadId}/messages?limit=40&before_id=${encodeURIComponent(oldestId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const data = await res.json() as ApiEnvelope<ChatMessage[]>
    if (data.ok && data.data) {
      const decrypted = await Promise.all(data.data.reverse().map(m => tryDecrypt(m)))
      setMessages(prev => [...decrypted, ...prev])
      setHasMore(data.data.length === 40)
    }
  }, [threadId, accessToken, hasMore, messages])

  // SP-2-01: WebSocket is primary now that live push genuinely works (a
  // real bug broke it silently until SP-1-12 — see that HANDOVER entry).
  // This only exists to cover a genuine outage: it runs solely while
  // `connected === false` (this effect's cleanup stops it the instant WS
  // reconnects, since `connected` flipping true re-runs the effect), at a
  // relaxed 10s, and skips a tick entirely when the tab isn't visible —
  // was unconditional at 3s regardless of WS health or tab visibility.
  useEffect(() => {
    if (!threadId || !accessToken || connected) return
    const poll = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await api.get<ApiEnvelope<ChatMessage[]>>(`/chat/threads/${threadId}/messages?limit=40`)
        if (res.data.ok && res.data.data) mergeNewMessages(res.data.data.slice().reverse())
      } catch {}
    }, 10000)
    return () => clearInterval(poll)
  }, [threadId, accessToken, connected, mergeNewMessages])

  // SP-1-06: retries a failed text send by re-running the normal send path —
  // image retry isn't supported here (the original File isn't kept around
  // after upload), the user can just resend the image from the picker.
  const retryMessage = useCallback((tempId: string) => {
    const msg = messages.find(m => m.id === tempId)
    if (!msg?.failed || msg.type !== 'text' || !msg.content_plain) return
    setMessages(prev => prev.filter(m => m.id !== tempId))
    sendMessage(msg.content_plain, 'text')
  }, [messages, sendMessage])

  return { messages, typing, connected, reconnecting: !connected && everConnected.current, sendMessage, sendImage, sendTyping, markThreadSeen, loadMore, hasMore, loading, recipientHasKey, requestStatus, isSender, retryMessage, keyChangeWarning, acceptKeyChange, deleteMessage }
}
