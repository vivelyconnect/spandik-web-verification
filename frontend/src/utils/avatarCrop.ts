// src/utils/avatarCrop.ts — SP-15-28: profile-avatar crop geometry + square
// export. Extends mediaCompress.ts's existing EXIF-orientation-correct,
// memory-bounded decode and WebP/JPEG encode primitives — never
// duplicates them (reused directly: `computeTargetDimensions`,
// `isHeic`, the same WebP-support probe).
//
// Geometry model ("cover-fit with pan/zoom", the same mental model as
// Instagram/most avatar croppers): the working image is drawn into a
// fixed SQUARE viewport. `zoom` is a multiplier on top of the minimum
// scale that already fully covers the viewport with no blank bars
// ("cover scale") — zoom=1 is therefore always a valid, fully-covering,
// centered default crop with zero manual work (Section 7). `offsetX`/
// `offsetY` are pan translation in VIEWPORT pixel units. All functions are
// pure and unit-independent — the caller may use CSS display pixels for
// interactive dragging or export-resolution pixels for the final crop, as
// long as `viewportSize` is expressed in the same unit as the returned
// offsets for that call.
import { computeTargetDimensions, isHeic } from './mediaCompress'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 3
export const MAX_AVATAR_OUTPUT = 1024 // Section 14: sensible final maximum, never upscaled beyond source

export interface ImageSize { width: number; height: number }
export interface CropState { zoom: number; offsetX: number; offsetY: number }
export interface SourceCropRect { x: number; y: number; width: number; height: number }

export { isHeic }

/** The minimum scale (zoom=1 baseline) at which `natural` fully covers a `viewport`-sized square with no blank area. */
export function coverScale(natural: ImageSize, viewport: number): number {
  if (natural.width <= 0 || natural.height <= 0 || viewport <= 0) return 1
  return viewport / Math.min(natural.width, natural.height)
}

/** Default crop: centered, minimum zoom, no pan — Section 7's "automatic initial framing". */
export function defaultCropState(): CropState {
  return { zoom: MIN_ZOOM, offsetX: 0, offsetY: 0 }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** Maximum pan (in viewport units) before the image edge would expose blank space, at the given zoom. */
function maxOffsets(natural: ImageSize, viewport: number, zoom: number): { maxX: number; maxY: number } {
  const scale = coverScale(natural, viewport) * zoom
  const scaledWidth = natural.width * scale
  const scaledHeight = natural.height * scale
  return {
    maxX: Math.max(0, (scaledWidth - viewport) / 2),
    maxY: Math.max(0, (scaledHeight - viewport) / 2),
  }
}

/** Clamps offsetX/offsetY so the crop viewport can never expose blank space (Section 8: "clamp translation after every zoom/pan"). */
export function clampCropState(natural: ImageSize, viewport: number, state: CropState): CropState {
  const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM)
  const { maxX, maxY } = maxOffsets(natural, viewport, zoom)
  return {
    zoom,
    offsetX: clamp(state.offsetX, -maxX, maxX),
    offsetY: clamp(state.offsetY, -maxY, maxY),
  }
}

/** Pans by (dx, dy) viewport units, always re-clamped — never exposes blank space. */
export function panCropState(natural: ImageSize, viewport: number, state: CropState, dx: number, dy: number): CropState {
  return clampCropState(natural, viewport, { ...state, offsetX: state.offsetX + dx, offsetY: state.offsetY + dy })
}

/** Sets zoom to an absolute value, re-clamping the existing pan against the new scale (Section 30: "zoom maintains valid clamped position"). */
export function zoomCropState(natural: ImageSize, viewport: number, state: CropState, newZoom: number): CropState {
  return clampCropState(natural, viewport, { ...state, zoom: newZoom })
}

/**
 * Converts the current crop viewport into a square pixel rectangle in the
 * SOURCE (working bitmap) coordinate space — this is what actually gets
 * drawn into the export canvas. Always square; always fully inside
 * [0,natural.width] x [0,natural.height] for a properly clamped state
 * (verified by tests, not just asserted).
 */
export function getSourceCropRect(natural: ImageSize, viewport: number, state: CropState): SourceCropRect {
  const scale = coverScale(natural, viewport) * state.zoom
  const scaledWidth = natural.width * scale
  const scaledHeight = natural.height * scale
  const leftEdge = (viewport - scaledWidth) / 2 + state.offsetX
  const topEdge = (viewport - scaledHeight) / 2 + state.offsetY
  const cropSourceSize = viewport / scale
  return {
    x: -leftEdge / scale,
    y: -topEdge / scale,
    width: cropSourceSize,
    height: cropSourceSize,
  }
}

/** Section 14: final output is never larger than the actual cropped source resolution, capped at MAX_AVATAR_OUTPUT — never upscaled. */
export function computeOutputSize(sourceCropPixels: number): number {
  return Math.max(1, Math.round(Math.min(MAX_AVATAR_OUTPUT, sourceCropPixels)))
}

// ── DOM-touching: decode + export (mirrors mediaCompress.ts's own split) ──

export type AvatarCropRejection =
  | { kind: 'heic' }
  | { kind: 'gif' } // Section 12: existing animated-GIF passthrough, never destructively flattened
  | { kind: 'unsupported' }
  | { kind: 'unreadable' }

/** Returns a rejection reason for files that should never open the crop dialog, or null if the file is crop-eligible. */
export function classifyAvatarFile(file: File): AvatarCropRejection | null {
  if (isHeic(file)) return { kind: 'heic' }
  if (file.type === 'image/gif') return { kind: 'gif' }
  if (!file.type.startsWith('image/')) return { kind: 'unsupported' }
  return null
}

export interface WorkingImage {
  bitmap: ImageBitmap
  natural: ImageSize
}

/**
 * Decodes `file` into a bounded working bitmap — EXIF orientation applied
 * during decode (never a separate rotation step to forget), downscaled to
 * mediaCompress.ts's existing safe long-edge so a 40-50MP photo is never
 * materialized at full resolution for interactive crop (Section 14, same
 * mobile-OOM protection compressImage() already relies on).
 */
export async function loadWorkingImage(file: File): Promise<WorkingImage> {
  let probe: ImageBitmap
  try {
    probe = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('unreadable')
  }
  const { width, height, scale } = computeTargetDimensions(probe.width, probe.height)
  if (scale >= 1) return { bitmap: probe, natural: { width: probe.width, height: probe.height } }

  probe.close()
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image', resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
  })
  return { bitmap, natural: { width, height } }
}

let webpSupportCache: Promise<boolean> | null = null
function supportsWebpEncode(): Promise<boolean> {
  if (webpSupportCache) return webpSupportCache
  webpSupportCache = new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    canvas.toBlob(blob => resolve(!!blob && blob.type === 'image/webp'), 'image/webp')
  })
  return webpSupportCache
}

/**
 * Draws the current crop into a square canvas and encodes it — the same
 * WebP-with-JPEG-fallback policy as compressImage(), so avatar output
 * follows one consistent, already-reviewed encoding policy. The canvas
 * round-trip is also what strips all original EXIF/metadata (no separate
 * step — the same free side effect compressImage() already relies on).
 */
export async function exportCroppedAvatar(working: WorkingImage, viewport: number, state: CropState, filenameBase: string): Promise<File> {
  const rect = getSourceCropRect(working.natural, viewport, state)
  const outputSize = computeOutputSize(rect.width)

  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(working.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, outputSize, outputSize)

  const useWebp = await supportsWebpEncode()
  const mimeType = useWebp ? 'image/webp' : 'image/jpeg'
  const ext = useWebp ? 'webp' : 'jpg'
  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, mimeType, 0.85))
  if (!blob) throw new Error('export failed')

  return new File([blob], `${filenameBase}.${ext}`, { type: mimeType })
}
