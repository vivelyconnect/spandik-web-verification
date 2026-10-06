// src/utils/api.ts — Axios instance with auto token refresh

import { markNetwork, usePwaStore } from '../pwa/pwa'
import axios from 'axios'
import { useAuthStore } from '../stores/authStore'
import { getCsrfProof, setCsrfProof } from './csrf'

const API_URL = import.meta.env.VITE_API_URL || 'https://api.spandik.com'

// SP-15-19: the refresh token lives in an HttpOnly cookie the browser
// attaches automatically on same-site requests to api.spandik.com — this
// module never sees or handles its value. `withCredentials: true` is what
// makes axios actually send/accept cookies on this cross-subdomain
// (app.spandik.com → api.spandik.com) request; the API's CORS layer
// already echoes the exact origin + `Access-Control-Allow-Credentials`
// rather than `*`, which is required for the browser to honor this.
export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// ── Request: attach access token ──────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Single-flight token refresh ──────────────────────────────
// SP-5-00 fix: previously main.tsx's cold-load bootstrap AND this
// interceptor each independently called POST /auth/refresh with the same
// refresh_token. The backend rotates refresh tokens on every use with no
// concurrency guard, so two simultaneous calls (guaranteed on a hard
// reload — every mounted query 401s before the access token is set,
// each triggering its own refresh here, racing the startup bootstrap
// call) both "succeed" but only the last DB write survives; whichever
// response the client kept could already be stale, failing the *next*
// refresh and logging the user out. Fix: exactly one HTTP refresh call
// in flight at a time, shared by every caller.
//
// SP-15-27: this is now the ONLY place that calls POST /auth/refresh and
// the only place that reads/writes the CSRF proof on the refresh path —
// main.tsx's startup bootstrap and App.tsx's own fallback effect both call
// this function directly instead of reimplementing refresh/CSRF logic
// themselves (previously main.tsx had a second, separate raw-axios
// implementation of this same call — see git history — which is exactly
// the kind of drift that let the CSRF cookie-domain defect go unnoticed:
// two independent places had to independently get cross-subdomain CSRF
// handling right). Uses the plain `axios` module (not the `api` instance)
// deliberately — going through `api`'s own response interceptor here would
// let a 401 on this call itself re-trigger this same function.
let refreshing = false
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

// Wave 2 blocker remediation (2026-09-27): only a genuine auth verdict from
// /auth/refresh ends the session — 401 (missing/invalid/expired/revoked
// refresh token, inactive account) or 403 (CSRF / session integrity). A 429,
// 5xx or timeout is transient: the refresh cookie is still valid, so keep
// the person signed in and retry — a 429 used to log real users out, and
// with the old per-IP limit, whole shared (CGNAT/college) IPs at once.
export function isTerminalRefreshFailure(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 401 || status === 403
}

// Next retry delay after a transient failure: 5s → 15s → 30s → 60s, never
// more often than that; honours the server's Retry-After (capped at 15 min).
export function refreshRetryDelayMs(attempt: number, retryAfter?: string | null): number {
  const steps = [5_000, 15_000, 30_000, 60_000]
  const base = steps[Math.min(attempt, steps.length - 1)]
  const serverSecs = Number(retryAfter)
  return Number.isFinite(serverSecs) && serverSecs > 0 ? Math.max(base, Math.min(serverSecs * 1000, 15 * 60_000)) : base
}

// One pending retry at most — no storms, however many requests failed.
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
let recoveryAttempt = 0
function scheduleRefreshRecovery(err: unknown) {
  usePwaStore.setState({ sessionRecovering: true })
  if (recoveryTimer) return
  const retryAfter = (err as { response?: { headers?: Record<string, string> } })?.response?.headers?.['retry-after']
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    refreshAccessToken().catch(() => {})
  }, refreshRetryDelayMs(recoveryAttempt++, retryAfter))
}

export async function refreshAccessToken(): Promise<string> {
  if (refreshing) {
    return new Promise((resolve, reject) => {
      refreshQueue.push({ resolve, reject })
    })
  }

  refreshing = true
  const { user, deviceId, setAuth, logout } = useAuthStore.getState()

  try {
    // Wave 3A 5A: tabs share one refresh cookie, so a cross-tab Web Lock
    // serializes their refreshes — a waiting tab then sends the cookie the
    // first tab just rotated, never the same token twice. The browser drops
    // the lock if its tab reloads mid-request; the server's short grace
    // window for the predecessor token covers that lost response.
    const post = () => axios.post(`${API_URL}/auth/refresh`, {}, {
      withCredentials: true,
      headers: { 'X-CSRF-Token': getCsrfProof() || '' },
    })
    const res = typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request('spandik-auth-refresh', post)
      : await post()
    const { access_token, csrf_token } = res.data.data
    // Rotates in lockstep with the freshly-rotated cookie the server just
    // set — without this, the *next* refresh would send the now-stale
    // proof and fail (the exact failure mode this task exists to close).
    setCsrfProof(csrf_token)
    markNetwork(true)
    recoveryAttempt = 0
    usePwaStore.setState({ sessionRecovering: false })
    if (user) {
      setAuth(user, access_token, deviceId!)
    } else {
      useAuthStore.setState({ accessToken: access_token })
    }
    refreshQueue.forEach(q => q.resolve(access_token))
    refreshQueue = []
    return access_token
  } catch (err) {
    refreshQueue.forEach(q => q.reject(err))
    refreshQueue = []
    // SP-5-09 + Wave 2 remediation: a terminal auth verdict ends the session.
    // A pure network failure (offline) keeps it for the offline shell; the
    // app refreshes again on reconnect. Any other failure (429/5xx/timeout)
    // keeps it too and retries with backoff — never a logout.
    if (isTerminalRefreshFailure(err)) {
      usePwaStore.setState({ sessionRecovering: false })
      logout()
    } else if (!(err as { response?: unknown })?.response && (err as { code?: string })?.code === 'ERR_NETWORK') {
      markNetwork(false)
    } else if (useAuthStore.getState().user) {
      scheduleRefreshRecovery(err)
    }
    throw err
  } finally {
    refreshing = false
  }
}

// ── Response: auto-refresh on 401 ────────────────────────────
api.interceptors.response.use(
  (res) => { markNetwork(true); return res },
  async (error) => {
    // SP-5-09: no response at all = the network is unreachable (not a
    // server verdict) — drives the offline banner/shell only.
    // Only a real connection failure — never a timeout on a slow network
    // or a cancelled request — counts as offline.
    if (!error.response && error.code === 'ERR_NETWORK') markNetwork(false)
    const original = error.config
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }
    original._retry = true

    try {
      const access_token = await refreshAccessToken()
      original.headers.Authorization = `Bearer ${access_token}`
      return api(original)
    } catch (err) {
      // Same classification as refreshAccessToken: only a terminal verdict
      // sends the person to Login; a transient failure keeps them here.
      const path = window.location.pathname
      if (isTerminalRefreshFailure(err) && !path.startsWith('/login') && !path.startsWith('/register') && !path.startsWith('/auth')) {
        window.location.href = '/login'
      }
      return Promise.reject(error)
    }
  }
)

// ── API helpers ───────────────────────────────────────────────
export const authApi = {
  register: (data: any)       => api.post('/auth/register', data),
  // SP-15-24: advisory-only live check — the caller is responsible for
  // debouncing and for aborting a superseded in-flight request via `signal`.
  usernameAvailability: (username: string, first_name: string, last_name: string, signal?: AbortSignal) =>
    api.get('/auth/username-availability', { params: { username, first_name, last_name }, signal }),
  login: (data: any)          => api.post('/auth/login', data),
  logout: (data?: any)        => api.post('/auth/logout', data || {}),
  verifyEmail: (data: any)    => api.post('/auth/verify-email', data),
  resendVerify: (email: string, turnstile_token?: string) => api.post('/auth/resend-verification', { email, turnstile_token }),
  forgotPassword: (email: string, turnstile_token?: string) => api.post('/auth/forgot-password', { email, turnstile_token }),
  resetPassword: (data: any)  => api.post('/auth/reset-password', data),
  addPhone: (phone: string)   => api.post('/auth/add-phone', { phone }),
  verifyPhone: (data: any)    => api.post('/auth/verify-phone', data),
  setup2fa: ()                => api.post('/auth/setup-2fa'),
  confirm2fa: (code: string)  => api.post('/auth/confirm-2fa', { totp_code: code }),
  disable2fa: (data: any)     => api.delete('/auth/disable-2fa', { data }),
  sessions: ()                => api.get('/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeAllOtherSessions: ()  => api.delete('/auth/sessions/others'),
}

export const userApi = {
  me: ()                      => api.get('/users/me'),
  update: (data: any)         => api.patch('/users/me', data),
  get: (username: string)     => api.get(`/users/${username}`),
  follow: (username: string)  => api.post(`/users/${username}/follow`),
  followers: (username: string, p?: number) => api.get(`/users/${username}/followers`, { params: { page: p } }),
  following: (username: string, p?: number) => api.get(`/users/${username}/following`, { params: { page: p } }),
  friendRequest: (username: string) => api.post(`/users/${username}/friend-request`),
  acceptFR: (id: string)      => api.post(`/users/friend-request/${id}/accept`),
  declineFR: (id: string)     => api.delete(`/users/friend-request/${id}`),
  friendRequests: ()          => api.get('/users/me/friend-requests'),
  friends: ()                 => api.get('/users/me/friends'),
  unfriend: (username: string) => api.delete(`/users/${username}/friend`), // unfriend OR cancel own pending request
  block: (username: string)   => api.post(`/users/${username}/block`),
  mute: (username: string)    => api.put(`/users/${username}/mute`),
  unmute: (username: string)  => api.delete(`/users/${username}/mute`),
  mutes: ()                   => api.get('/users/me/mutes'),
  mutedKeywords: ()           => api.get('/users/me/muted-keywords'),
  saveMutedKeywords: (keywords: string[]) => api.put('/users/me/muted-keywords', { keywords }),
  privacy: ()                 => api.get('/users/me/privacy'),
  savePrivacy: (data: any)    => api.put('/users/me/privacy', data),
  notificationPreferences: () => api.get('/users/me/notification-preferences'),
  saveNotificationPreferences: (data: any) => api.put('/users/me/notification-preferences', data),
  search: (q: string)         => api.get('/users/search', { params: { q } }),
  suggestions: ()             => api.get('/users/suggestions'),
  mentionSuggestions: (q: string) => api.get('/users/mention-suggestions', { params: { q } }),
  onboarding: ()               => api.get('/users/onboarding'),
  saveInterests: (interests: string[]) => api.put('/users/me/interests', { interests }),
  completeOnboarding: ()       => api.post('/users/onboarding/complete'),
}

export const postApi = {
  create: (data: any)         => api.post('/posts', data),
  feed: (cursor?: string)     => api.get('/posts/feed', { params: { cursor } }),
  explore: (page?: number)    => api.get('/posts/explore', { params: { page } }),
  stories: ()                 => api.get('/posts/stories'),
  get: (id: string)           => api.get(`/posts/${id}`),
  delete: (id: string)        => api.delete(`/posts/${id}`),
  edit: (id: string, content: string, opts?: { link_preview_dismissed?: boolean }) =>
    api.patch(`/posts/${id}`, { content, ...opts }),
  // SP-2-19: toggle-only owner update — independent of a content edit, so
  // it never touches the 15-minute edit window (see api/src/routes/posts.ts).
  updateControls: (id: string, data: { comments_enabled?: boolean; sharing_enabled?: boolean }) =>
    api.patch(`/posts/${id}`, data),
  // SP-2-17: owner-only "who can see this" — the same PATCH SP-0-04R built (it
  // also moves any attached media between the public/private stores). The
  // response carries the AUTHORITATIVE resulting visibility + controls.
  updateVisibility: (id: string, visibility: 'public' | 'friends' | 'private') =>
    api.patch(`/posts/${id}`, { visibility }),
  // SP-11-06: server-side SSRF-safe fetch/parse/cache — see
  // api/src/services/safeOutboundFetch.ts + linkPreview.ts. `signal` lets
  // the composer cancel a stale request when the URL changes mid-typing.
  linkPreview: (url: string, signal?: AbortSignal) => api.post('/posts/link-preview', { url }, { signal }),
  react: (id: string, type: string) => api.post(`/posts/${id}/react`, { type }),
  reactions: (id: string, type?: string) => api.get(`/posts/${id}/reactions`, { params: { type } }),
  // SP-2-14: cursor pagination, roots by default, or a flattened thread
  // page under `threadRootId`.
  comments: (id: string, cursor?: string, threadRootId?: string) =>
    api.get(`/posts/${id}/comments`, { params: { cursor, thread_root_id: threadRootId } }),
  comment: (id: string, data: any) => api.post(`/posts/${id}/comments`, data),
  editComment: (postId: string, commentId: string, content: string, opts?: { link_preview_dismissed?: boolean }) =>
    api.patch(`/posts/${postId}/comments/${commentId}`, { content, ...opts }),
  save: (id: string)          => api.post(`/posts/${id}/save`),
  saved: ()                   => api.get('/posts/me/saved'),
  // SP-11-07: the real server authorization boundary behind every
  // app-mediated external-share action — ShareSheet MUST call this fresh
  // immediately before native share/WhatsApp/Telegram/X/Copy-link, never
  // trust its own possibly-stale `sharingEnabled` prop.
  externalShare: (id: string) => api.post(`/posts/${id}/external-share`),
  // SP-11-07: reuses the existing create path (repost_id + is_story) rather
  // than a second story-authorization subsystem — see api/src/routes/posts.ts.
  shareToStory: (id: string)  => api.post('/posts', { type: 'story', is_story: true, repost_id: id }),
  hashtag: (tag: string, p?: number) => api.get(`/posts/hashtag/${tag}`, { params: { page: p } }),
  trending: ()                => api.get('/posts/trending/hashtags'),
  deleteComment: (postId: string, commentId: string) => api.delete(`/posts/${postId}/comments/${commentId}`),
}

// SP-9-01
export const eventApi = {
  create: (data: any)      => api.post('/events', data),
  get: (slug: string)      => api.get(`/events/${slug}`),
}

export const notifApi = {
  list: (p?: number)          => api.get('/notifications', { params: { page: p } }),
  readAll: ()                 => api.post('/notifications/read-all'),
  read: (id: string)          => api.post(`/notifications/${id}/read`),
}

export const searchApi = {
  all: (q: string)            => api.get('/search', { params: { q, type: 'all' } }),
  users: (q: string)          => api.get('/search', { params: { q, type: 'users' } }),
  posts: (q: string)          => api.get('/search', { params: { q, type: 'posts' } }),
  hashtags: (q: string)       => api.get('/search', { params: { q, type: 'hashtags' } }),
}

// SP-2-09: must match the API's SYNC_BUFFER_LIMIT_BYTES (api/src/routes/
// media.ts) — files at or under this go through the simple buffered
// multipart form the API has always accepted; anything larger is sent as
// a raw request body (Content-Type = the file's own mime type, metadata in
// the query string) so the API can stream it straight to R2 instead of
// buffering the whole thing in Worker memory.
const UPLOAD_STREAM_THRESHOLD_BYTES = 6 * 1024 * 1024 // 6MB

// SP-2-15: opts are optional so every existing caller keeps working
// unchanged — `onProgress` (0-100) and `signal` (an AbortController's
// signal, for a real cancel button) are additive.
export interface UploadOpts {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

function readVideoDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (duration: number | null) => {
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

export const mediaApi = {
  upload: async (file: File, purpose: string, extra?: Record<string, string>, opts?: UploadOpts) => {
    const metadata = { ...extra }
    if (file.type.startsWith('video/')) {
      const duration = await readVideoDuration(file)
      if (duration !== null) metadata.duration_seconds = duration.toFixed(3)
    }
    const onUploadProgress = opts?.onProgress
      ? (e: { loaded: number; total?: number }) => opts.onProgress!(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
      : undefined
    if (file.size > UPLOAD_STREAM_THRESHOLD_BYTES) {
      return api.post('/media/upload', file, {
        headers: { 'Content-Type': file.type },
        params: { purpose, ...metadata },
        // Large files (video, up to 95MB) can take far longer than the
        // default 15s timeout on a real mobile connection.
        timeout: 120000,
        onUploadProgress, signal: opts?.signal,
      })
    }
    const form = new FormData()
    form.append('file', file)
    form.append('purpose', purpose)
    Object.entries(metadata).forEach(([k, v]) => form.append(k, v))
    return api.post('/media/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress, signal: opts?.signal,
    })
  }
}

export const chatApi = {
  threads: ()                       => api.get('/chat/threads'),
  thread: (id: string)              => api.get(`/chat/threads/${id}`),
  createThread: (userId: string)    => api.post('/chat/threads', { user_id: userId }),
  messages: (id: string, p?: number) => api.get(`/chat/threads/${id}/messages`, { params: { page: p, limit: 40 } }),
  sendMessage: (id: string, data: any) => api.post(`/chat/threads/${id}/messages`, data),
  requests: ()                      => api.get('/chat/threads/requests'),
  acceptRequest: (id: string)       => api.post(`/chat/threads/${id}/accept`),
  declineRequest: (id: string)      => api.post(`/chat/threads/${id}/decline`),
}

// SP-3-01: mints a short-lived (60s), single-use WS ticket — never a raw
// access token in the presence WebSocket URL. Same shape as chatApi's
// (inline) ws-ticket mint useChat.ts already calls for ChatRoom sockets.
export const presenceApi = {
  wsTicket: () => api.post<{ data: { ticket: string; expires_in: number } }>('/presence/ws-ticket'),
}

// SP-3-05: server-authoritative 1:1 call sessions. The callee never gets a
// join ticket from the incoming-call push itself (see hooks/incomingCall.ts)
// — accept/join-ticket below are what actually mint one, only for an
// already-authorized participant of an already-accepted call.
export const callApi = {
  start: (targetUserId: string, mode: 'video' | 'audio' = 'video') =>
    api.post<{ data: { call_id: string; room_code: string; expires_in: number; mode: string } }>(
      '/calls', { target_user_id: targetUserId, mode }
    ),
  accept: (callId: string) =>
    api.post<{ data: { room_code: string; ticket: string; expires_in: number } }>(`/calls/${callId}/accept`),
  decline: (callId: string) => api.post(`/calls/${callId}/decline`),
  cancel: (callId: string) => api.post(`/calls/${callId}/cancel`),
  joinTicket: (callId: string) =>
    api.post<{ data: { room_code: string; ticket: string; expires_in: number } }>(`/calls/${callId}/join-ticket`),
}

// SP-4-02/SP-15-17
export type ReportTargetType = 'post' | 'comment' | 'user' | 'message'
export const reportApi = {
  submit: (data: {
    target_type: ReportTargetType; target_id: string; reason: string; details?: string
    evidence_text?: string; evidence_media?: string; evidence_media_mime?: string
    // Remediation (2026-08-04): server-enforced + persisted, not just a
    // client-side checkbox — see api/src/config/reportEvidence.ts.
    evidence_consent?: boolean; consent_version?: string; locale?: string
  }) =>
    api.post<{ data: { id: string; consent_version: string }; message?: string }>('/reports', data),
}

// SP-4-08/SP-15-13 — IT Rules 2021 grievance mechanism, deliberately
// unauthenticated. `category` defaults server-side to 'general_content'
// when omitted; `authority_reference` is required only for 'law_enforcement'.
export type GrievanceCategory =
  | 'general_content' | 'account' | 'child_safety' | 'ncii' | 'impersonation' | 'morphed_media' | 'law_enforcement'

export const grievanceApi = {
  submit: (data: {
    name: string; email: string; phone?: string; subject: string; details: string; related_link?: string
    category?: GrievanceCategory; authority_reference?: string; turnstile_token: string
  }) =>
    api.post<{ data: { id: string; category: GrievanceCategory; is_urgent: boolean; ack_due_at: string; resolve_due_at: string } }>('/grievance', data),
}
