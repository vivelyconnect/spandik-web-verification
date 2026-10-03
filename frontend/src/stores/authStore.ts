// src/stores/authStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearCsrfProof } from '../utils/csrf'
import { useCallStore } from './callStore'
import { clearAllLastFeeds } from '../utils/feedCache'
import { forgetWrapKey } from '../utils/keyVault'

export interface AuthUser {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  profile_pic_url: string | null
  cover_pic_url: string | null
  email_verified: boolean
  phone_verified: boolean
  role: string
  theme: string
  preferred_lang: string
  auto_translate: boolean
  totp_enabled: boolean
  is_verified_badge: boolean
  strike_count: number
  show_email?: boolean
  show_phone?: boolean
  show_dob?: boolean
  show_gender?: boolean
  show_bio?: boolean
  allow_dm?: boolean
  easy_mode?: boolean
}

// SP-5-07: Easy Mode is applied as ONE root attribute (not a className —
// theme code overwrites `documentElement.className` wholesale) that
// themes.css keys its type-scale/contrast overrides off. Mirrored to
// localStorage so main.tsx's pre-render script applies it before paint.
export function applyEasyMode(on: boolean) {
  if (typeof document === 'undefined') return
  if (on) document.documentElement.setAttribute('data-easy-mode', '1')
  else document.documentElement.removeAttribute('data-easy-mode')
  try { if (on) localStorage.setItem('spandik_easy_mode', '1'); else localStorage.removeItem('spandik_easy_mode') } catch {}
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  deviceId: string | null
  _hydrated: boolean
  setAuth: (user: AuthUser, accessToken: string, deviceId: string) => void
  setUser: (user: Partial<AuthUser>) => void
  setAccessToken: (token: string) => void
  setTheme: (theme: string) => void
  logout: () => void
}

// SP-15-19: the refresh token no longer lives here (or anywhere in JS-
// reachable storage) — it's an HttpOnly cookie the browser attaches
// automatically, invisible to this store and to any XSS. `_hydrated`+`user`
// persisting is what lets a cold reload know "this browser was previously
// logged in, attempt a silent refresh" (see main.tsx/App.tsx) without ever
// holding the actual credential in JS.
// Wave 3A step 4: while signed in, the chat private key (and any decrypted
// older keys) sit in this browser's storage (wrapped since Wave 3B, see
// utils/keyVault.ts) — the Chat PIN protects only the SERVER backup
// (utils/e2e.ts owns these key names). On
// logout they are removed, so a shared or later-stolen browser profile no
// longer holds them; the next sign-in restores with the Chat PIN like a new
// device. Only when a server backup exists (has_passphrase) — otherwise this
// device holds the only copy and clearing it would destroy the account's chat
// identity. Contact pins / contact public keys are public data and stay.
// Kept here, not in e2e.ts, so the auth store doesn't pull tweetnacl into the
// main bundle. Wave 3B (Option B): the key is stored wrapped — logout also
// deletes the wrapping key and the unwrapped in-memory copy (the e2e module
// is already loaded in any session that used chat keys).
function clearLocalChatKeys(userId: string): void {
  try {
    const stored = JSON.parse(localStorage.getItem(`spandik_e2e_${userId}`) || 'null')
    if (!stored?.has_passphrase) return
    for (const suffix of ['', '_salt', '_history']) localStorage.removeItem(`spandik_e2e_${userId}${suffix}`)
    forgetWrapKey(userId).catch(() => {})
    import('../utils/e2e').then(m => m.clearE2EKeys(userId)).catch(() => {})
  } catch { /* unreadable entry: leave it */ }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      deviceId: null,
      _hydrated: false,

      setAuth: (user, accessToken, deviceId) => {
        // Apply theme immediately
        document.documentElement.className = `theme-${user.theme}`
        localStorage.setItem('spandik_theme', user.theme)
        // SP-5-06: mirror preferred_lang so a returning user sees the
        // pre-login Login screen in their own language, not English —
        // same pattern as the theme above.
        if (user.preferred_lang) localStorage.setItem('spandik_lang', user.preferred_lang)
        applyEasyMode(!!user.easy_mode)
        set({ user, accessToken, deviceId })
      },

      setUser: (partial) => {
        const current = get().user
        if (!current) return
        const updated = { ...current, ...partial }
        if (partial.preferred_lang) localStorage.setItem('spandik_lang', partial.preferred_lang)
        if ('easy_mode' in partial) applyEasyMode(!!partial.easy_mode)
        set({ user: updated })
      },

      setAccessToken: (token) => set({ accessToken: token }),

      setTheme: (theme) => {
        document.documentElement.className = `theme-${theme}`
        localStorage.setItem('spandik_theme', theme)
        const current = get().user
        if (current) set({ user: { ...current, theme } })
      },

      logout: () => {
        const userId = get().user?.id
        set({ user: null, accessToken: null, deviceId: null })
        if (userId && typeof localStorage !== 'undefined') clearLocalChatKeys(userId)
        // SP-5-07: Easy Mode is per-account — never carry it to the next
        // person who signs in on this browser.
        applyEasyMode(false)
        // SP-5-09: the offline last-feed cache never outlives the session.
        if (typeof localStorage !== 'undefined') clearAllLastFeeds()
        // SP-15-27: the CSRF proof is a per-session anti-forgery value, not
        // an identity credential, but it must still be cleared on logout —
        // a revoked/logged-out browser retaining a stale proof must not be
        // able to attempt (and, if the server ever accepted it, succeed at)
        // a refresh call after the user explicitly signed out.
        clearCsrfProof()
        // SP-3-05: an active ringing overlay (with its ringtone/vibration)
        // must never survive a logout — IncomingCallOverlay's own cleanup
        // effect only fires on unmount/call-id change, which a logout
        // doesn't guarantee synchronously (AppShell/App re-render first).
        // Clearing the store directly here stops it immediately regardless
        // of component tree timing.
        useCallStore.getState().setIncoming(null)
        useCallStore.setState({ resolved: null })
        // Keep theme preference on logout
      },
    }),
    {
      name: 'spandik_auth',
      partialize: (state) => ({
        user: state.user,
        deviceId: state.deviceId,
        // accessToken is intentionally NOT persisted (security)
      }),
    }
  )
)

// SP-5-07: the ONE Easy Mode read for components (per-account server truth).
export const useEasyMode = () => useAuthStore(s => !!s.user?.easy_mode)
