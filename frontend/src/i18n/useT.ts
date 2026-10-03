// src/i18n/useT.ts — SP-5-06
import { useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '../stores/authStore'
import { loadLang, onLangLoaded, langVersion, isLangLoaded, translate, type Lang, type StringKey } from './strings'

// Pre-login (Login.tsx) has no user record yet to read preferred_lang from —
// falls back to the last-known language mirrored to localStorage at login/
// register time (same pattern as spandik_theme), so a returning user still
// sees Login in their own language; a genuinely first-time visitor gets 'en'.
export function useLang(): Lang {
  const userLang = useAuthStore(s => s.user?.preferred_lang)
  const stored = userLang || (typeof window !== 'undefined' ? localStorage.getItem('spandik_lang') : null)
  return stored === 'hi' || stored === 'bn' ? stored : 'en'
}

// Re-renders the caller once `lang`'s dictionary has arrived (it is loaded
// before first render for the saved language; this covers later switches).
export function useLangReady(lang: Lang) {
  useSyncExternalStore(onLangLoaded, langVersion)
  useEffect(() => { if (!isLangLoaded(lang)) loadLang(lang).catch(() => {}) }, [lang])
}

export function useT() {
  const lang = useLang()
  useLangReady(lang)
  return (key: StringKey, vars?: Record<string, string>) => translate(lang, key, vars)
}
