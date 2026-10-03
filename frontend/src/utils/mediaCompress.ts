import type { StringKey } from '../i18n/strings'
// src/utils/mediaCompress.ts — SP-2-15: client-side media compression
// before upload. Resize to a max long-edge, re-encode as WebP (falls back
// to JPEG where the browser can't encode WebP), fix EXIF orientation via
// the browser's own decoder, and — as a free side effect of the
// canvas round-trip — strip all EXIF/metadata, since a canvas-drawn image
// never carries the original file's metadata forward (this is also the
// privacy win the spec calls out: EXIF GPS never survives this path).

const MAX_LONG_EDGE = 2048
const WEBP_QUALITY = 0.8
const JPEG_QUALITY = 0.8

export const MAX_VIDEO_DURATION_SECONDS = 60
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024 // must match api/src/routes/media.ts's MAX_VIDEO_BYTES
// Wave 2 blocker remediation: public post/Story video is MP4 (H.264) only —
// the one format proven end to end in production (the API enforces the same
// rule on the MIME type and the container bytes). Chat does not use this.
export const SUPPORTED_VIDEO_TYPES = ['video/mp4']
export const VIDEO_ACCEPT = SUPPORTED_VIDEO_TYPES.join(',')

export interface CompressResult {
  file: File
  originalBytes: number
  compressedBytes: number
  skipped: boolean // true for GIF passthrough, or when compression wasn't possible/beneficial
}

export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
}

// Pure, DOM-free — the part of this module that's actually worth unit
// testing without a real browser/canvas. Preserves aspect ratio, never
// upscales.
export function computeTargetDimensions(width: number, height: number, maxLongEdge = MAX_LONG_EDGE): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

let webpSupport: Promise<boolean> | null = null
function supportsWebpEncode(): Promise<boolean> {
  if (webpSupport) return webpSupport
  webpSupport = new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    canvas.toBlob(blob => resolve(!!blob && blob.type === 'image/webp'), 'image/webp')
  })
  return webpSupport
}

// Animated GIFs pass through untouched — canvas would flatten them to a
// single frame and lose the animation entirely. HEIC/HEIF is rejected with
// friendly copy rather than silently converted — no HEIC decoder exists in
// non-Safari browsers without a heavy WASM library, and the spec allows
// either path ("detected and converted, or clearly rejected").
export async function compressImage(file: File): Promise<CompressResult> {
  const originalBytes = file.size

  if (isHeic(file)) {
    throw new Error('HEIC photos aren\'t supported yet — switch your camera to "Most Compatible" (JPEG) in Settings, or convert this photo before uploading.')
  }
  if (!file.type.startsWith('image/')) {
    return { file, originalBytes, compressedBytes: originalBytes, skipped: true }
  }
  if (file.type === 'image/gif') {
    return { file, originalBytes, compressedBytes: originalBytes, skipped: true }
  }

  let bitmap: ImageBitmap
  try {
    // imageOrientation: 'from-image' applies EXIF rotation during decode —
    // the canvas draw below then bakes it in, so the compressed output is
    // always right-side-up regardless of what the original claimed.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This image could not be read — it may be corrupted or in an unsupported format.')
  }

  const { width: targetWidth, height: targetHeight, scale } = computeTargetDimensions(bitmap.width, bitmap.height)

  // Re-decode directly at the target size when downscaling a very large
  // original — createImageBitmap performs the resize as part of decode, so
  // a 40-50MP photo is never fully materialized at full resolution in
  // memory (the mobile-OOM edge case from the v1.6 spec).
  if (scale < 1) {
    bitmap.close()
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image', resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'high',
    })
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close(); return { file, originalBytes, compressedBytes: originalBytes, skipped: true } }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  // WebP preserves alpha fine at lossy quality, so PNG transparency
  // survives this re-encode without a separate code path.
  const useWebp = await supportsWebpEncode()
  const mimeType = useWebp ? 'image/webp' : 'image/jpeg'
  const quality = useWebp ? WEBP_QUALITY : JPEG_QUALITY

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality))
  if (!blob || blob.size >= originalBytes) {
    // Never ship a "compressed" file bigger than the original — can happen
    // with an already-tiny or already-well-optimized source image.
    return { file, originalBytes, compressedBytes: originalBytes, skipped: true }
  }

  const ext = useWebp ? 'webp' : 'jpg'
  const newName = file.name.replace(/\.[^.]+$/, '') + '.' + ext
  const compressed = new File([blob], newName, { type: mimeType })
  return { file: compressed, originalBytes, compressedBytes: compressed.size, skipped: false }
}

// A plain `{ok, error}` shape rather than a discriminated union — this
// project's tsconfig has `strict: false` (strictNullChecks off), under
// which TS's control-flow narrowing of a `{ok:true} | {ok:false,error}`
// union at call sites is unreliable (confirmed: `if (v.ok) {} else {
// v.error }` fails to narrow and errors "Property 'error' does not exist").
// `error` simply always exists, `null` when there isn't one — no narrowing
// required to read it.
export interface VideoValidation { ok: boolean; error: StringKey | null; vars?: Record<string, string> }

// Client-side is the real enforcement point for duration — the server
// (api/src/routes/media.ts) can only cheaply check byte size, not decode a
// video to read its duration, so this check is not just a UX nicety.
export function validateVideo(file: File): Promise<VideoValidation> {
  if (!SUPPORTED_VIDEO_TYPES.includes(file.type)) {
    return Promise.resolve({ ok: false, error: 'video.mp4Only' })
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return Promise.resolve({ ok: false, error: 'video.tooLarge', vars: { mb: String(MAX_VIDEO_BYTES / 1024 / 1024) } })
  }
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    const url = URL.createObjectURL(file)
    const cleanup = () => URL.revokeObjectURL(url)
    video.onloadedmetadata = () => {
      cleanup()
      if (video.duration > MAX_VIDEO_DURATION_SECONDS) {
        resolve({ ok: false, error: 'video.tooLong', vars: { s: String(MAX_VIDEO_DURATION_SECONDS) } })
      } else {
        resolve({ ok: true, error: null })
      }
    }
    video.onerror = () => { cleanup(); resolve({ ok: false, error: 'video.unreadable' }) }
    video.src = url
  })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
