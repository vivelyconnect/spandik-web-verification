// src/utils/csrf.ts — SP-15-27: canonical CSRF-proof store.
//
// This is NOT an authentication credential. It is the JS-readable half of
// the API's double-submit CSRF pair (api/src/utils/authCookies.ts) — proof
// that the caller is legitimate same-origin JS, not a cross-site forgery.
// Possession of this value alone, without the API's own HttpOnly
// `__Host-spandik_refresh` cookie (which only the browser can attach, and
// which this module never sees or stores), authenticates nobody.
//
// Why this module exists (SP-15-26's own production verification found the
// defect this fixes): the API's CSRF cookie is `__Host-`-prefixed and
// therefore host-locked to api.spandik.com — the frontend at the sibling
// origin app.spandik.com can never read it via `document.cookie`, so every
// authenticated hard page reload (which must call POST /auth/refresh to
// re-derive the memory-only access token) failed CSRF validation and
// silently logged the user out. The API now ALSO returns the same value in
// the JSON body of register/login/refresh (delivered over its existing
// strict-allowlist, credentialed CORS policy — never a wildcard origin),
// and this module is the one place that persists it at the frontend's own
// origin, where it can legitimately be read back.
//
// localStorage (not sessionStorage): needs to survive a hard reload (the
// whole point) and be visible across tabs of the same origin (a second tab
// must see a proof rotated by the first, not hold a stale one — see the
// rotation-synchronization requirement in api.ts's refreshAccessToken()).
// Always read fresh from storage, never cached in a module-level variable,
// so a same-origin tab always sees another tab's latest rotation.
const STORAGE_KEY = 'spandik_csrf_proof'

export function getCsrfProof(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setCsrfProof(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearCsrfProof(): void {
  localStorage.removeItem(STORAGE_KEY)
}
