// src/components/ui/VerifiedBadge.tsx — SP-5-08
//
// The ONE verified-account mark. Truth source is only the server's
// `is_verified_badge` field (some endpoints send it as a raw D1 0/1 integer,
// others as a boolean) — never email/phone verification, role, age,
// followers or anything local. Meaning is "Verified account" only; it does
// not claim safety, identity or endorsement.
import { useT } from '../../i18n/useT'

// Strict on purpose: a raw `0` must render nothing (a bare `{x && ...}`
// with x === 0 would print a stray "0"), and only real true/1 counts.
export function isVerifiedBadge(value: unknown): boolean {
  return value === true || value === 1
}

export default function VerifiedBadge({ verified, size = 16 }: { verified: unknown; size?: number }) {
  const t = useT()
  if (!isVerifiedBadge(verified)) return null
  const label = t('avatar.verifiedAccount')
  return (
    <svg data-testid="verified-badge" role="img" aria-label={label} width={size} height={size}
      viewBox="0 0 16 16" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}>
      <title>{label}</title>
      <circle cx="8" cy="8" r="8" fill="var(--link)" />
      <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="var(--white)" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
