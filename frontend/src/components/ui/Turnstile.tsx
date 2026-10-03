// src/components/ui/Turnstile.tsx — SP-4-07
//
// Thin wrapper around Cloudflare's Turnstile widget. Loads the CF script
// once (shared across every mounted instance), renders a managed widget,
// and reports each solved token via onToken. reset() (exposed via ref) gets
// a fresh token ready for the next submit attempt — a Turnstile token is
// single-use, so a form that lets the user retry needs to reset after every
// submit, success or failure.

import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

// Public sitekey — not a secret, safe to ship in the frontend bundle (same
// pattern as VITE_API_URL's hardcoded production fallback in utils/api.ts).
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAD-SxNiq7XTU2EYE'

const SCRIPT_ID = 'cf-turnstile-script'
let scriptLoadPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptLoadPromise) return scriptLoadPromise
  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Turnstile script'))
    document.head.appendChild(script)
  })
  return scriptLoadPromise
}

export interface TurnstileHandle { reset: () => void }

interface TurnstileProps {
  onToken: (token: string) => void
  action: string // shows up per-action in the Cloudflare Turnstile dashboard analytics
}

const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile({ onToken, action }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    reset: () => { if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current) },
  }))

  useEffect(() => {
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        action,
        callback: onToken,
      })
    }).catch(() => { /* widget just won't render; server-side verify still rejects the request either way */ })

    return () => {
      cancelled = true
      if (window.turnstile && widgetIdRef.current) window.turnstile.remove(widgetIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} />
})

export default Turnstile
