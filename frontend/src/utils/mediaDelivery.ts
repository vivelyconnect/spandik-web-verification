// src/utils/mediaDelivery.ts — SP-11-08: canonical Cloudflare Image
// Transformations eligibility boundary + finite responsive presets.
//
// Fails closed: ONLY a URL on Spandik's own public media host
// (media.spandik.com), with no query string at all, is ever rewritten into
// a transform URL. Everything else — /media/serve/* (private/authenticated),
// a `?mt=` capability-token URL, an external URL, or anything this function
// doesn't recognize — is returned completely unchanged, byte-for-byte the
// same URL the caller passed in. Never decide eligibility from filename
// shape; the host + "no query string" check is the entire boundary,
// deliberately conservative.
//
// Delivery goes through `${API_URL}/media/thumb/<key>`, NOT the raw
// `/cdn-cgi/image/...` URL interface. A production investigation found
// Cloudflare's Transformations product keeps an internal cache of
// transformed output that its own purge_cache API cannot reach (it
// rejects /cdn-cgi/image/ URLs outright) — a previously-viewed transform
// of a since-privatized post could keep serving stale bytes indefinitely.
// The zone's image_resizing (URL interface) setting is now OFF entirely;
// /media/thumb/* re-checks the object's live storage_scope from D1 on
// every request, before ever asking Cloudflare to transform anything, so
// a since-privatized key simply never reaches the transform engine again.
// See docs/MEDIA_DELIVERY.md for the full investigation.

const PUBLIC_MEDIA_HOST = 'media.spandik.com'
const API_URL = import.meta.env.VITE_API_URL || 'https://api.spandik.com'

// Canonical, finite width buckets — every transform request snaps its
// target width UP to the nearest bucket at or above the real rendered
// width (never down, so images are never served visibly blurry). This is
// what actually bounds transformation cardinality (Cloudflare counts each
// unique source+options combination against the Images Free plan's
// 5,000/month allowance): no matter how many distinct rendered sizes exist
// across the app, only these buckets are ever requested.
const WIDTH_BUCKETS = [40, 64, 96, 160, 320, 480, 640, 960, 1280, 1600]

const STANDARD_QUALITY = 80
const DATA_SAVER_QUALITY = 60

export interface DeliveryResult {
  /** The single <img src> to use — the larger (2x) candidate when eligible. */
  src: string
  /** `${url} 1x, ${url} 2x`, or null when the source isn't transform-eligible (use `src` alone). */
  srcSet: string | null
}

// Section 6's canonical eligibility check — fails closed. Exported so
// call sites (and tests) can ask the same question directly.
export function isPublicTransformEligible(url: string | null | undefined): boolean {
  if (!url) return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (parsed.hostname !== PUBLIC_MEDIA_HOST) return false
  // A legitimate public media URL never carries a query string — this
  // also means a private `?mt=` capability-token URL (which is never on
  // this host anyway, but belt-and-suspenders) can never pass here.
  if (parsed.search) return false
  return true
}

function snapWidth(targetPx: number): number {
  for (const bucket of WIDTH_BUCKETS) {
    if (bucket >= targetPx) return bucket
  }
  return WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1]
}

function transformUrl(originalUrl: string, width: number, quality: number): string {
  // isPublicTransformEligible already confirmed this is a media.spandik.com
  // URL with no query string, so the pathname (minus its leading slash) is
  // exactly the object key /media/thumb/* looks up in media_assets.
  const key = new URL(originalUrl).pathname.replace(/^\//, '')
  return `${API_URL}/media/thumb/${key}?w=${width}&q=${quality}`
}

// `renderedWidthPx` is the real CSS pixel width the image is actually
// displayed at (Avatar's own `size` prop, a feed image's known column
// width, etc.) — never `window.innerWidth`. Data Saver drops the 2x
// candidate entirely and uses a lower bounded quality; it never changes
// which images render, only how many bytes each one costs.
export function buildDelivery(
  originalUrl: string | null | undefined,
  renderedWidthPx: number,
  dataSaver: boolean
): DeliveryResult {
  if (!isPublicTransformEligible(originalUrl)) {
    return { src: originalUrl || '', srcSet: null }
  }
  const quality = dataSaver ? DATA_SAVER_QUALITY : STANDARD_QUALITY
  const width1x = snapWidth(renderedWidthPx)
  if (dataSaver) {
    return { src: transformUrl(originalUrl!, width1x, quality), srcSet: null }
  }
  const width2x = snapWidth(renderedWidthPx * 2)
  const url1x = transformUrl(originalUrl!, width1x, quality)
  const url2x = transformUrl(originalUrl!, width2x, quality)
  return { src: url2x, srcSet: `${url1x} 1x, ${url2x} 2x` }
}
