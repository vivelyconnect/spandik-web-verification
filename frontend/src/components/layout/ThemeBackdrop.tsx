// src/components/layout/ThemeBackdrop.tsx — SP-5-00, reworked SP-5-12R (2026-07-27)
//
// Per the spec's own top-of-file note (and SPANDIK_AGENT_PROMPT.md's v1.7
// Decision Log, which wins where they conflict): the mandala + heritage
// horizon are PERMANENT BRAND CHROME across ALL themes — saffron/aurora/ink
// included, not exclusive to heritage-sunset. So this renders regardless of
// which theme is active; only two things change with theme: (1) the mandala
// is recolored (terracotta light / warm amber dark, equal visual presence —
// NOT dimmed for dark, see SP-5-12R rework notes below); (2) the horizon
// photo is dimmed+desaturated for dark surfaces per spec, since it's a
// light-mode photographic crop, not a redrawn dark asset.
//
// SP-5-12R rework (CTO feedback 2026-07-27): the horizon was a right-corner
// decoration (right:0, capped width) instead of a true edge-to-edge footer,
// and every mandala echo stacked only in the top-left while opacity had been
// pushed twice past spec to compensate for pale source art. Fixed by (a)
// making the horizon a real full-width, bottom-anchored strip using the new
// wide 1920x486 source (mobile: dedicated 900x355 crop below 768px), with a
// CSS mask gradient (not a baked-in pixel fade) fading its top into the
// canvas — a baked fade gets cropped away unpredictably by object-fit:cover
// bottom-anchoring, since cover crops from the top first; (b) rebuilding the
// mandala as a hand-drawn SVG (mandala-corner.svg, currentColor strokes) from
// the bolder reference art, recolored via a CSS mask (background-color +
// mask-image) instead of an <img>, so theme recoloring is a one-line color
// swap with no extra asset; and mirroring the same cluster into the top-right
// corner via `transform: scaleX(-1)` — one asset, two corners. No bottom
// mandalas at any breakpoint; the bottom belongs to the skyline alone.
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useState, useEffect, type CSSProperties } from 'react'

type Variant = 'full' | 'subtle' | 'minimal' | 'hidden'

function variantForPath(pathname: string): Variant {
  if (
    pathname === '/login' || pathname === '/register' || pathname === '/forgot' ||
    pathname === '/terms' || pathname === '/privacy' || pathname.startsWith('/legal/')
  ) return 'full'
  if (pathname === '/connect') return 'hidden' // LiveConnect video calls
  if (pathname === '/chats' || pathname.startsWith('/chats/') || pathname === '/settings') return 'minimal'
  return 'subtle' // feed, explore, profile, post detail, hashtag, buzz, friends, saved
}

// Opacity by screen type — [mandala, horizon]. The mandala side of this
// table came down from the old 0.50/0.30/0.22 (which compensated for pale
// source art) now that the SVG rebuild is bold/saturated on its own — see
// docs/DESIGN_SYSTEM.md for the full before/after reasoning. Horizon values
// are close to before: never reported as too faint, and the edge-to-edge
// change already gives it far more presence than the old corner crop.
const OPACITY: Record<Exclude<Variant, 'hidden'>, [number, number]> = {
  full:    [0.34, 0.56],
  subtle:  [0.20, 0.38],
  minimal: [0.14, 0.28],
}

const DARK_THEMES = new Set(['aurora', 'heritage-sunset-dark'])

const MANDALA_SVG = '/brand/mandala-corner.svg'
const MANDALA_LIGHT = '#E89654'
const MANDALA_DARK = '#FFB070' // warm amber glow — matches the spec's dark mandala hue, at full (not dimmed) presence

// Cascading cluster, decreasing scale/opacity from the corner — reads as a
// fuller decorative motif than one lone flower. Same SVG, no extra asset.
const MANDALA_ECHOES = [
  { size: 'clamp(170px, 21vw, 300px)', top: '0%',  inset: '0%',  opMul: 1 },
  { size: 'clamp(112px, 13.5vw, 194px)', top: '9%',  inset: '7%',  opMul: 0.68 },
  { size: 'clamp(72px, 8.5vw, 122px)',  top: '16%', inset: '13%', opMul: 0.46 },
]

function MandalaCluster({ corner, color, baseOpacity }: { corner: 'left' | 'right'; color: string; baseOpacity: number }) {
  const sideProp = corner === 'left' ? 'left' : 'right'
  return (
    <>
      {MANDALA_ECHOES.map((e, i) => {
        const style: CSSProperties = {
          position: 'absolute', top: e.top, [sideProp]: e.inset,
          width: e.size, height: e.size,
          backgroundColor: color,
          WebkitMaskImage: `url(${MANDALA_SVG})`,
          maskImage: `url(${MANDALA_SVG})`,
          WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'top left', maskPosition: 'top left',
          WebkitMaskSize: 'contain', maskSize: 'contain',
          opacity: baseOpacity * e.opMul,
        }
        if (corner === 'right') style.transform = 'scaleX(-1)'
        return <div key={i} style={style} />
      })}
    </>
  )
}

export default function ThemeBackdrop() {
  const location = useLocation()
  const userTheme = useAuthStore(s => s.user?.theme)
  const [localTheme, setLocalTheme] = useState(() => localStorage.getItem('spandik_theme') || 'heritage-sunset')

  useEffect(() => {
    const onStorage = () => setLocalTheme(localStorage.getItem('spandik_theme') || 'heritage-sunset')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const theme = userTheme || localTheme
  const isDark = DARK_THEMES.has(theme)
  const variant = variantForPath(location.pathname)

  if (variant === 'hidden') return null

  const [mandalaOp, horizonOp] = OPACITY[variant]
  const mandalaColor = isDark ? MANDALA_DARK : MANDALA_LIGHT

  // Horizon: dim + desaturate the light-mode photo for dark surfaces
  // (per spec — never invert, never redraw). Fade into the canvas is a CSS
  // mask on the rendered box, not a baked-in pixel fade, so it survives
  // object-fit:cover's bottom-anchored crop at every viewport width.
  const horizonStyle: CSSProperties = isDark
    ? { opacity: horizonOp * 0.55, filter: 'brightness(0.7) saturate(0.8) hue-rotate(-6deg)' }
    : { opacity: horizonOp }

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', zIndex: 0 }}>
      <MandalaCluster corner="left" color={mandalaColor} baseOpacity={mandalaOp} />
      <MandalaCluster corner="right" color={mandalaColor} baseOpacity={mandalaOp} />
      <picture>
        <source media="(max-width: 767px)" srcSet="/brand/heritage-sunset-horizon-mobile.webp" />
        <img
          src="/brand/heritage-sunset-horizon.webp"
          alt=""
          fetchPriority="high"
          className="spandik-heritage-horizon"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%',
            objectFit: 'cover', objectPosition: 'bottom center',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 24%, black 100%)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 24%, black 100%)',
            ...horizonStyle,
          }}
        />
      </picture>
    </div>
  )
}
