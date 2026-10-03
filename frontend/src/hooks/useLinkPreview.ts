// src/hooks/useLinkPreview.ts — SP-11-06/SP-11-06R
//
// One shared preview-generation hook reused by the post composer, the root
// comment composer, and reply boxes (Section 12: "extract a small reusable
// hook instead of copying the entire logic"). Debounced + AbortController
// race-safe: a stale response for an earlier URL can never overwrite the
// preview for whatever URL the user has since typed (Section 35).
//
// Client-side extraction here is only a UX trigger for WHICH url to ask the
// server about — the server always independently re-derives the real
// preview url from the FINAL persisted content at publish time, never
// trusts this as authoritative (Section 29).
import { useEffect, useRef, useState } from 'react'
import { postApi } from '../utils/api'
import type { LinkPreviewData } from '../components/post/LinkPreviewCard'

// SP-11-06R Gap A: https:// only — matches the server's own
// extractFirstPreviewableUrl (api/src/services/linkPreview.ts). An earlier
// http:// URL in the text is simply skipped, never matched, so the first
// ELIGIBLE (https) URL wins rather than the extractor finding an
// ineligible URL first and giving up.
const URL_IN_TEXT_RE = /https:\/\/[^\s<>"']+/i
export function extractFirstUrl(text: string): string | null {
  const m = URL_IN_TEXT_RE.exec(text)
  if (!m) return null
  const trimmed = m[0].replace(/[.,!?;:)\]}'"]+$/, '')
  return trimmed || null
}

export interface UseLinkPreviewResult {
  preview: LinkPreviewData | null
  loading: boolean
  dismissed: boolean
  dismiss: () => void
  reset: () => void
}

export function useLinkPreview(text: string): UseLinkPreviewResult {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    const url = extractFirstUrl(text)
    if (url === urlRef.current) return
    urlRef.current = url
    abortRef.current?.abort()
    setPreview(null)
    setDismissed(false)
    if (!url) { setLoading(false); return }

    const abort = new AbortController()
    abortRef.current = abort
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await postApi.linkPreview(url, abort.signal)
        if (abort.signal.aborted || urlRef.current !== url) return
        const data = res.data?.data
        setPreview(data?.available ? {
          url: data.url, hostname: data.hostname, title: data.title,
          description: data.description, site_name: data.site_name, image_url: data.image_url,
        } : null)
      } catch {
        if (!abort.signal.aborted) setPreview(null)
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [text])

  function dismiss() { setDismissed(true) }
  function reset() {
    abortRef.current?.abort()
    urlRef.current = null
    setPreview(null)
    setLoading(false)
    setDismissed(false)
  }

  return { preview, loading, dismissed, dismiss, reset }
}
