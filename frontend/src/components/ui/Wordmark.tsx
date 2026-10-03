// src/components/ui/Wordmark.tsx — SP-5-13
//
// The approved wordmark asset (dark navy text, transparent background) is
// theme-independent brand artwork — never recolored, never a CSS-text
// reconstruction. Per the brand spec's own dark-mode rule ("if the dark
// surface does not support the dark wordmark, place the existing wordmark
// on a light brand-safe container rather than modifying it"), dark themes
// get a small cream pill behind the mark instead of an invented dark
// variant — the asset itself is untouched either way.
import { useAuthStore } from '../../stores/authStore'
import { useState, useEffect } from 'react'

const DARK_THEMES = new Set(['aurora', 'heritage-sunset-dark'])

export default function Wordmark({ height = 32, style, onClick }: { height?: number; style?: React.CSSProperties; onClick?: () => void }) {
  const userTheme = useAuthStore(s => s.user?.theme)
  const [localTheme, setLocalTheme] = useState(() => localStorage.getItem('spandik_theme') || 'heritage-sunset')

  useEffect(() => {
    const onStorage = () => setLocalTheme(localStorage.getItem('spandik_theme') || 'heritage-sunset')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isDark = DARK_THEMES.has(userTheme || localTheme)
  const img = <img src="/brand/spandik-wordmark.png" alt="Spandik" style={{ height, width: 'auto', display: 'block' }} />

  if (!isDark) return <div onClick={onClick} style={{ display: 'inline-block', ...style }}>{img}</div>

  return (
    <div onClick={onClick} style={{ display: 'inline-flex', background: '#FEF9F3', padding: `${height * 0.22}px ${height * 0.4}px`, borderRadius: height * 0.28, ...style }}>
      {img}
    </div>
  )
}
