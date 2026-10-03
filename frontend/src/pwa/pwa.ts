// src/pwa/pwa.ts — SP-5-09: service-worker registration, safe update path,
// online state and the install prompt. The worker itself (public/sw.js)
// only ever caches the public app shell and hashed static assets.
import { create } from 'zustand'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  online: boolean
  // Set when a real request got NO response (navigator.onLine is unreliable:
  // it stays true on Wi-Fi without internet, and under some emulation).
  networkDown: boolean
  // Wave 2 blocker remediation: the session is still valid but the last
  // token refresh hit a transient failure (429/5xx/timeout) — keep the
  // person signed in and retry (utils/api.ts), never force /login.
  sessionRecovering: boolean
  updateReady: boolean
  installEvent: InstallPromptEvent | null
}
export const usePwaStore = create<PwaState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  networkDown: false,
  sessionRecovering: false,
  updateReady: false,
  installEvent: null,
}))

let registration: ServiceWorkerRegistration | null = null
let updateRequested = false

export function initPwa() {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => usePwaStore.setState({ online: true, networkDown: false }))
  window.addEventListener('offline', () => usePwaStore.setState({ online: false }))
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // we show our own, calmer prompt (second visit on)
    usePwaStore.setState({ installEvent: e as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => usePwaStore.setState({ installEvent: null }))
  countVisit()
  // Reconnect probe: only while a request has already failed with no
  // response — one tiny unauthenticated /health call every 15s.
  const apiUrl = import.meta.env.VITE_API_URL || 'https://api.spandik.com'
  setInterval(() => {
    if (!usePwaStore.getState().networkDown) return
    fetch(`${apiUrl}/health`, { cache: 'no-store' }).then(r => { if (r.ok) markNetwork(true) }).catch(() => {})
  }, 15_000)

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // Reload ONLY when the person accepted an update. A first install also
  // fires controllerchange (clients.claim) — reloading then would wipe
  // whatever they were typing seconds after their first visit (found in
  // E2E: a login form emptied mid-fill).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return
    updateRequested = false
    window.location.reload()
  })
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
    registration = reg
    // Only an UPDATE (a worker already controls the page) needs the prompt —
    // a first install just starts working.
    if (reg.waiting && navigator.serviceWorker.controller) usePwaStore.setState({ updateReady: true })
    reg.addEventListener('updatefound', () => {
      const next = reg.installing
      next?.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) usePwaStore.setState({ updateReady: true })
      })
    })
  }).catch(() => {})
}

export function applyUpdate() {
  if (!registration?.waiting) return
  updateRequested = true
  registration.waiting.postMessage('SKIP_WAITING') // controllerchange → reload
}

// ── Install prompt: offered from the second visit on, never nagging ──
const VISITS_KEY = 'spandik_visits'
const DISMISSED_KEY = 'spandik_install_dismissed_at'
const SESSION_KEY = 'spandik_visit_counted'
export const INSTALL_SNOOZE_MS = 14 * 24 * 3600 * 1000

function countVisit() {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return
    sessionStorage.setItem(SESSION_KEY, '1')
    localStorage.setItem(VISITS_KEY, String(Number(localStorage.getItem(VISITS_KEY) || '0') + 1))
  } catch {}
}

// Pure decision (unit-tested).
export function shouldOfferInstall(visits: number, dismissedAt: number | null, now: number, hasEvent: boolean, standalone: boolean): boolean {
  if (!hasEvent || standalone) return false // iOS/unsupported browsers never fire the event → nothing shown
  if (visits < 2) return false
  return dismissedAt === null || now - dismissedAt > INSTALL_SNOOZE_MS
}

export function installOfferState(): { visits: number; dismissedAt: number | null; standalone: boolean } {
  let visits = 0, dismissedAt: number | null = null
  try {
    visits = Number(localStorage.getItem(VISITS_KEY) || '0')
    const d = localStorage.getItem(DISMISSED_KEY); dismissedAt = d ? Number(d) : null
  } catch {}
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  return { visits, dismissedAt, standalone: !!standalone }
}

export function dismissInstall() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch {}
  usePwaStore.setState({ installEvent: null })
}

export async function promptInstall() {
  const ev = usePwaStore.getState().installEvent
  if (!ev) return
  await ev.prompt()
  usePwaStore.setState({ installEvent: null })
}

// The ONE "can we reach the network right now" read for UI (banner, route
// guard): the browser says offline, or a real request just got no response.
export const useIsOffline = () => usePwaStore(s => !s.online || s.networkDown)
export const useSessionRecovering = () => usePwaStore(s => s.sessionRecovering)
export function markNetwork(reachable: boolean) {
  if (usePwaStore.getState().networkDown === !reachable) return
  usePwaStore.setState({ networkDown: !reachable })
}
