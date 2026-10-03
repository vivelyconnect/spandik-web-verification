// src/components/ui/Avatar.tsx
//
// SP-5-08: presentational only — Avatar never handles clicks itself. A
// caller that wants the avatar to navigate/act wraps it in its own semantic
// <Link>/<button> with an accessible name (the old unused `onClick` prop,
// which silently did nothing, is gone).
import { useDataSaverStore } from '../../stores/dataSaverStore'
import { buildDelivery } from '../../utils/mediaDelivery'
import { useT } from '../../i18n/useT'

// Finite semantic scale (audited against real usages, SP-5-08). Existing
// surfaces not touched by SP-5-08 keep their literal pixel sizes — `size`
// still accepts a number, this is for new/refined surfaces to converge on.
export const AVATAR_SIZE = {
  xs: 24,   // inline chips, nav
  sm: 32,   // compact rows, story-card owner
  md: 40,   // feed author, standard list rows
  lg: 48,   // people rows (Friends/Follow lists, chat list)
  xl: 64,
  hero: 88, // profile header
} as const
export type AvatarSize = keyof typeof AVATAR_SIZE

interface AvatarProps {
  src: string | null | undefined
  name: string
  size?: number | AvatarSize
  // Real presence only (thread `is_online`). Renders a dot only when true —
  // never an "offline" dot, which would reveal more than presence privacy
  // (SP-0-06) intends.
  online?: boolean
  // Authoritative active-story state only (the caller must know the person
  // has an unexpired story right now). Drawn INSIDE the given size so
  // toggling it never shifts layout.
  ring?: boolean
  style?: React.CSSProperties
}

const COLORS = [
  'linear-gradient(135deg,#FF7A1A,#FF4D6D)',
  'linear-gradient(135deg,#6C47FF,#FF6B6B)',
  'linear-gradient(135deg,#00D4B4,#6C47FF)',
  'linear-gradient(135deg,#FFB020,#FF7A1A)',
  'linear-gradient(135deg,#FF5FA6,#6C47FF)',
  'linear-gradient(135deg,#0BD4C1,#00B09A)',
  'linear-gradient(135deg,#C8F135,#00D4B4)',
]

function getColor(name: string): string {
  if (!name) return COLORS[0]
  const i = name.charCodeAt(0) % COLORS.length
  return COLORS[i]
}

export function avatarPx(size: number | AvatarSize = 'md'): number {
  return typeof size === 'number' ? size : AVATAR_SIZE[size]
}

// Ring stroke + the canvas-colored gap between ring and face.
export function ringInset(px: number): number {
  return (px >= 48 ? 3 : 2) + 2
}

export default function Avatar({ src, name, size = 'md', online, ring, style }: AvatarProps) {
  const t = useT()
  const dataSaver = useDataSaverStore(s => s.enabled)
  const px = avatarPx(size)
  const inset = ring ? ringInset(px) : 0
  const face = px - inset * 2
  const delivery = buildDelivery(src, face, dataSaver)
  const safeName = name || ''
  const initials = safeName
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  return (
    <div data-avatar-ring={ring ? 'story' : undefined} style={{
      position: 'relative',
      width: px,
      height: px,
      flexShrink: 0,
      borderRadius: '50%',
      ...(ring ? { background: 'var(--btn-brand-bg)', padding: inset - 2 } : null),
      ...style,
    }}>
      <div style={{
        position: 'relative',
        width: ring ? face + 4 : px,
        height: ring ? face + 4 : px,
        borderRadius: '50%',
        ...(ring ? { background: 'var(--white)', padding: 2 } : null),
      }}>
        {src ? (
          <img
            src={delivery.src}
            srcSet={delivery.srcSet || undefined}
            alt={name}
            style={{
              width: face,
              height: face,
              borderRadius: '50%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={(e) => {
              // Fallback to initials on error
              const el = e.currentTarget as HTMLImageElement
              el.style.display = 'none'
              if (el.nextSibling) (el.nextSibling as HTMLElement).style.display = 'flex'
            }}
          />
        ) : null}
        <div style={{
          width: face,
          height: face,
          borderRadius: '50%',
          background: getColor(safeName),
          display: src ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: face * 0.35,
          fontWeight: 700,
          color: '#fff',
          position: src ? 'absolute' : 'relative',
          top: ring ? 2 : 0, left: ring ? 2 : 0,
        }}>
          {initials}
        </div>
      </div>
      {online === true && (
        <span role="img" aria-label={t('chat.online')} style={{
          position: 'absolute',
          bottom: 0, right: 0,
          width: Math.max(10, Math.round(px * 0.26)),
          height: Math.max(10, Math.round(px * 0.26)),
          borderRadius: '50%',
          background: 'var(--success)',
          border: '2px solid var(--white)',
        }} />
      )}
    </div>
  )
}
