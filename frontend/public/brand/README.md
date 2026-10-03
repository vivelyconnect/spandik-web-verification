# Spandik Brand Assets (authoritative — theme-independent)
Final approved assets. NEVER recolored, inverted, or regenerated per theme (SP-5-13).
- spandik-app-icon-{32,48,96,192,512}.png — app icon set (favicon/PWA/touch)
- spandik-app-icon-master-2048.png — master; derive spandik-app-icon-maskable-512.png from this (SP-5-13: ~80% safe-area content on full-bleed background)
- spandik-mini-mark-master-2048.png — mini mark master; derive sized copies as needed
- spandik-lockup-full.png — primary logo master (icon + wordmark + tagline, full composite; artwork only; never rebuild in CSS text). Renamed from `spandik-wordmark-master-4096.png` (SP-5-18 — the old name was misleading, it was always the full lockup, not a wordmark-only asset).
- spandik-lockup.png — sized, trimmed, transparent-background composite derived from the master above; used by `Lockup.tsx` on auth screens and Settings→About so the icon+wordmark+tagline are always ONE positioned element (SP-5-18 — a separately positioned tagline was the actual cause of the reported alignment bug).
- spandik-lockup-500.webp — SP-5-10 display-size derivative of `spandik-lockup.png`: LANCZOS-resampled to 500×168 (3× the largest on-screen size) and saved as LOSSLESS WebP with alpha — same artwork, no recolour/crop; 56KB instead of 246KB. Used by `Lockup.tsx`.
- spandik-wordmark.png — icon+wordmark only, no tagline; nav use only (derived from the master, SP-5-13).
- spandik-tagline.png — "Connect. Share. Belong." isolated; not currently used standalone (SP-5-18 removed its separate-element usage on auth screens) but kept for a future context needing tagline-only art (e.g. SP-5-11's Welcome Experience).
Agent-generated (SP-5-12, per docs/THEME_HERITAGE_SUNSET_SPEC.md): mandala-corner.svg, heritage-sunset-horizon.svg, heritage-sunset-horizon-mobile.svg. Visual reference: docs/brand-reference/heritage-sunset-theme-reference.png (reference ONLY — never shipped as a CSS background).
