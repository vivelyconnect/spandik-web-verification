// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { initPwa } from './pwa/pwa'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/themes.css'
import { useAuthStore } from './stores/authStore'
import { refreshAccessToken } from './utils/api'
import { loadLang } from './i18n/strings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2, retry: 1, refetchOnWindowFocus: false },
  },
})

// SP-5-00: Heritage Sunset is the default for anyone without an explicit
// saved preference — logged-out visitors, fresh installs, and (since
// user.theme round-trips into this same key on every login/setTheme call,
// see authStore.ts) any account that's never actually changed it either.
// Apply saved theme before render (prevents flash).
const savedTheme = localStorage.getItem('spandik_theme') || 'heritage-sunset'
document.documentElement.className = `theme-${savedTheme}`
// SP-5-07: Easy Mode mirror (see authStore.applyEasyMode) — before paint.
if (localStorage.getItem('spandik_easy_mode') === '1') document.documentElement.setAttribute('data-easy-mode', '1')

// ── Silent token refresh on app startup ──────────────────────
// This runs BEFORE React renders so the user is never logged out on reload.
// SP-15-19: the refresh token itself is an HttpOnly cookie, invisible here
// — `user` persisting (but not the access token, which is memory-only) is
// what signals "this browser was previously logged in, the browser should
// still be holding a valid refresh cookie, attempt a silent refresh."
//
// SP-15-27: delegates entirely to api.ts's canonical refreshAccessToken()
// instead of reimplementing the refresh call + CSRF-proof handling here —
// this used to be a second, independent raw-axios implementation of the
// exact same request, which is how a cross-subdomain CSRF defect went
// unnoticed (see api.ts's own header comment on refreshAccessToken for the
// full incident). One canonical implementation now owns: obtaining the
// CSRF proof, calling POST /auth/refresh, rotating the stored proof, and
// single-flight coordination with any other caller (App.tsx's own fallback
// effect, the response interceptor) that might also invoke it.
async function bootstrap() {
  const { user } = useAuthStore.getState()
  // Load the saved UI language's dictionary before first render, so a
  // Hindi/Bengali user never sees an English flash (it is a separate chunk).
  const lang = user?.preferred_lang || localStorage.getItem('spandik_lang')
  const langReady = lang === 'hi' || lang === 'bn' ? loadLang(lang).catch(() => {}) : undefined

  if (user && !useAuthStore.getState().accessToken) {
    // refreshAccessToken() already calls the store's logout() internally on
    // failure (expired/invalid/missing refresh token, or a rejected CSRF
    // proof) — this only needs to swallow the rethrown error so bootstrap
    // still resolves and the app renders (to the now-logged-out state).
    await refreshAccessToken().catch(() => {})
  }
  await langReady
}

bootstrap().then(() => {
  initPwa() // SP-5-09: service worker, offline state, install prompt
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  )
})
