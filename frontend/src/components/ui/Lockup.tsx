// src/components/ui/Lockup.tsx — SP-5-18
//
// The approved composite logo (icon + wordmark + tagline, together, exactly
// as approved) as ONE image — auth screens, splash, and Settings→About must
// never position the tagline as a separate element; that separate
// positioning was the actual cause of the reported misalignment. Derived
// from spandik-lockup-full.png (see frontend/public/brand/README.md).
// Same dark-theme brand-safe-container treatment as Wordmark.tsx.
import { useAuthStore } from '../../stores/authStore'
import { useState, useEffect } from 'react'

const DARK_THEMES = new Set(['aurora', 'heritage-sunset-dark'])

export default function Lockup({ height = 64, style }: { height?: number; style?: React.CSSProperties }) {
  const userTheme = useAuthStore(s => s.user?.theme)
  const [localTheme, setLocalTheme] = useState(() => localStorage.getItem('spandik_theme') || 'heritage-sunset')

  useEffect(() => {
    const onStorage = () => setLocalTheme(localStorage.getItem('spandik_theme') || 'heritage-sunset')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isDark = DARK_THEMES.has(userTheme || localTheme)
  // SP-5-10: a 500px-wide lossless WebP derived from spandik-lockup.png
  // (displayed at <=56px tall ≈ 166px wide, so 500px covers 3x screens) —
  // 56KB instead of 246KB on every auth screen. Same artwork, resampled.
  const img = <img src="/brand/spandik-lockup-500.webp" width={500} height={168} alt="Spandik — Connect. Share. Belong." style={{ height, width: 'auto', display: 'block' }} />

  if (!isDark) return <div style={{ display: 'inline-block', ...style }}>{img}</div>

  return (
    <div style={{ display: 'inline-flex', background: '#FEF9F3', padding: `${height * 0.16}px ${height * 0.28}px`, borderRadius: height * 0.2, ...style }}>
      {img}
    </div>
  )
}
