// src/App.tsx
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { MotionConfig, LazyMotion, domAnimation, m as motion } from 'framer-motion'
import { useAuthStore } from './stores/authStore'
import { useIsOffline, useSessionRecovering } from './pwa/pwa'
import { refreshAccessToken } from './utils/api'
import AppShell from './components/layout/AppShell'
import ThemeBackdrop from './components/layout/ThemeBackdrop'
// SP-5-10: these always-mounted prompts (and the chat-crypto code they pull
// in) load as their own chunk right after first paint instead of blocking it.
const PinModal = lazy(() => import('./components/chat/PinModal'))
const SecureChatsPrompt = lazy(() => import('./components/chat/SecureChatsPrompt'))
const BackupUpgradePrompt = lazy(() => import('./components/chat/BackupUpgradePrompt'))
const ReconsentPrompt = lazy(() => import('./components/legal/ReconsentPrompt'))
import OnboardingGate from './components/onboarding/OnboardingGate'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { pageVariants, pageTransition } from './motion/presets'
import CelebrationBurst from './motion/CelebrationBurst'
import { useCelebrationStore } from './stores/celebrationStore'

// SP-5-10: route-level code splitting. Login and Home (the two entry
// screens) stay in the main bundle so the most common first paint needs no
// extra round-trip; every other page is its own lazily-loaded chunk.
// Auth pages
import Login        from './pages/auth/Login'
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPw = lazy(() => import('./pages/auth/ForgotPassword'))
const Onboarding = lazy(() => import('./pages/Onboarding'))

// App pages
import Home         from './pages/Home'
const Explore = lazy(() => import('./pages/Explore'))
const Profile = lazy(() => import('./pages/Profile'))
const FollowList = lazy(() => import('./pages/FollowList'))
const PostDetail = lazy(() => import('./pages/PostDetail'))
const Chats = lazy(() => import('./pages/Chats'))
const ChatRoom = lazy(() => import('./pages/ChatRoom'))
const Connect = lazy(() => import('./pages/Connect'))
const Buzz = lazy(() => import('./pages/Buzz'))
const Settings = lazy(() => import('./pages/Settings'))
const Friends = lazy(() => import('./pages/Friends'))
const Saved = lazy(() => import('./pages/Saved'))
const Hashtag = lazy(() => import('./pages/Hashtag'))
const EventNew = lazy(() => import('./pages/EventNew'))
const NotFound = lazy(() => import('./pages/NotFound'))

// Legal pages
const Terms = lazy(() => import('./pages/legal/Terms'))
const Privacy = lazy(() => import('./pages/legal/Privacy'))
const Grievance = lazy(() => import('./pages/legal/Grievance'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.accessToken)
  const hasUser = useAuthStore(s => !!s.user)
  const hydrated = useAuthStore(s => s._hydrated)
  const offline = useIsOffline()
  const recovering = useSessionRecovering()
  if (!hydrated) return null
  // SP-5-09: a signed-in person who opens the app with NO network can't
  // refresh yet (no response ≠ rejected session) — show the offline shell
  // instead of Login. Nothing server-side is reachable offline; the only
  // local data shown is this account's own privacy-filtered saved feed.
  // On reconnect App re-runs the normal refresh; a real rejection logs out.
  // Wave 2: a valid session whose refresh hit a transient failure (429/5xx)
  // stays here too — utils/api.ts retries; only a terminal verdict logs out.
  return token || (hasUser && (offline || recovering)) ? <>{children}</> : <Navigate to="/login" replace />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.accessToken)
  return token ? <Navigate to="/" replace /> : <>{children}</>
}

export default function App() {
  const user          = useAuthStore(s => s.user)
  const accessToken   = useAuthStore(s => s.accessToken)
  const [hydrated, setHydrated] = useState(false)
  const location = useLocation()

  // On startup: access token is not persisted. Restore it via the refresh
  // cookie (SP-15-19 — invisible here, the browser attaches it
  // automatically; persisted `user` is the only local signal this browser
  // was previously logged in). Goes through the same single-flight
  // refreshAccessToken() api.ts uses for 401s, so a cold reload never fires
  // two concurrent /auth/refresh calls (which used to race the backend's
  // refresh-token rotation and could leave the client holding an
  // already-invalidated token — see api.ts).
  useEffect(() => {
    if (accessToken) { setHydrated(true); return }
    if (!user) { setHydrated(true); return }

    refreshAccessToken()
      .catch(() => {})
      .finally(() => setHydrated(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // SP-5-09: back online after an offline start → normal refresh (server
  // decides; a rejection logs out and PrivateRoute redirects to Login).
  const offline = useIsOffline()
  useEffect(() => {
    if (!offline && useAuthStore.getState().user && !useAuthStore.getState().accessToken) {
      refreshAccessToken().catch(() => {})
    }
  }, [offline])

  // Expose hydrated state for PrivateRoute via store
  useEffect(() => {
    useAuthStore.setState({ _hydrated: hydrated })
  }, [hydrated])

  // Ensure E2E keys on every app open
  useEffect(() => {
    if (user?.id && accessToken) {
      import('./utils/e2e').then(m => m.ensureE2EKeys(user.id, accessToken)).catch(() => {})
    }
  }, [user?.id, accessToken])

  const celebration = useCelebrationStore(s => s.active)
  const clearCelebration = useCelebrationStore(s => s.clear)

  return (
    // SP-5-10: LazyMotion + `m` components (imported app-wide as `motion`)
    // ship only the DOM animation features actually used (no drag/layout)
    // instead of the whole framer-motion bundle. `strict` throws if a full
    // `motion` import ever slips back in. Features load synchronously, so
    // nothing ever renders stuck at an `initial` state.
    <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--white)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: 'var(--shadow)',
          },
        }}
      />

      {/* Chat PIN modal — shown after login on a new device to restore an encrypted key backup */}
      {user && <Suspense fallback={null}><PinModal /></Suspense>}

      {/* SP-1-04: nudges accounts still on an unencrypted key backup to set a Chat PIN */}
      {user && <Suspense fallback={null}><SecureChatsPrompt /></Suspense>}

      {/* SP-14-02: re-wraps a pre-v3 (offline-guessable) Chat-PIN backup as KDF v3 */}
      {user && <Suspense fallback={null}><BackupUpgradePrompt /></Suspense>}

      {/* SP-15-12: prompts re-acceptance when terms_version/privacy_version has bumped since the user last consented */}
      {user && <Suspense fallback={null}><ReconsentPrompt /></Suspense>}

      {/* SP-11-01: server-authoritative resume redirect for an incomplete
          onboarding — covers every path back into the app OTHER than the
          one Register.tsx already drives directly (fresh signup). */}
      {user && <OnboardingGate />}

      {/* SP-5-00: mounted once here (not per-route) so the mandala/heritage
          horizon backdrop never duplicates its assets; variant + light/dark
          treatment are derived per-route inside the component itself. Must
          render before the content wrapper below in DOM order AND that
          wrapper must have its own explicit stacking context (position +
          z-index), or a position:fixed z-index:0 layer like this one would
          actually paint ABOVE normal-flow content, not behind it. */}
      <ThemeBackdrop />

      {/* SP-5-02: first-post/first-friend delight moment, driven by
          useCelebrationStore — mounted once, never a second overlay. */}
      <CelebrationBurst show={!!celebration} onDone={clearCelebration} />

      {/* SP-2-07: keyed on pathname so a crash on one route doesn't
          permanently white-screen the app — navigating away remounts the
          boundary fresh. SP-5-02: the same key also drives a lightweight
          page-entrance fade — no exit animation/AnimatePresence, so a route
          change is never delayed waiting for one. */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <motion.div
          key={location.pathname}
          initial="initial"
          animate="animate"
          variants={pageVariants}
          transition={pageTransition}
        >
        <ErrorBoundary key={location.pathname} lang={user?.preferred_lang}>
          <Suspense fallback={null}>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/forgot"   element={<PublicRoute><ForgotPw /></PublicRoute>} />

            {/* Legal — public, no auth needed */}
            <Route path="/terms"    element={<Terms />} />
            <Route path="/privacy"  element={<Privacy />} />
            <Route path="/legal/grievance" element={<Grievance />} />

            {/* SP-11-01: standalone, full-screen (no AppShell nav) — same
                treatment as Register.tsx, a guided flow, not a normal
                browsing surface. Still protected (PrivateRoute): a fresh
                signup already has a live session by the time it lands here. */}
            <Route path="/onboarding" element={<PrivateRoute><Onboarding /></PrivateRoute>} />

            {/* Protected app routes */}
            <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
              <Route index              element={<Home />} />
              <Route path="explore"     element={<Explore />} />
              <Route path="chats"       element={<Chats />} />
              <Route path="chats/:id"   element={<ChatRoom />} />
              <Route path="chats/new/:username" element={<ChatRoom />} />
              <Route path="connect"     element={<Connect />} />
              <Route path="buzz"        element={<Buzz />} />
              <Route path="friends"     element={<Friends />} />
              <Route path="saved"       element={<Saved />} />
              <Route path="settings"    element={<Settings />} />
              <Route path="u/:username" element={<Profile />} />
              <Route path="u/:username/followers" element={<FollowList />} />
              <Route path="u/:username/following" element={<FollowList />} />
              <Route path="p/:id"       element={<PostDetail />} />
              <Route path="tag/:tag"    element={<Hashtag />} />
              <Route path="events/new"  element={<EventNew />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
        </motion.div>
      </div>
    </MotionConfig>
    </LazyMotion>
  )
}
