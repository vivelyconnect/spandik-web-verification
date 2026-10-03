// src/components/onboarding/InterestPicker.tsx — SP-11-01: the ONE
// canonical interest-selection UI, used identically by Onboarding.tsx's
// interests step and Settings.tsx's "Interests" section — never two
// separate implementations with separate business logic (Section 16 of the
// SP-11-01 spec). Purely a controlled chip grid; the caller owns save
// timing and API calls.
import { useT } from '../../i18n/useT'
import { Check } from 'lucide-react'
import type { StringKey } from '../../i18n/strings'
import { INTEREST_KEYS } from '../../utils/interests'

export default function InterestPicker({
  selected, onToggle,
}: {
  selected: Set<string>
  onToggle: (key: string) => void
}) {
  const t = useT()
  return (
    <div role="group" aria-label={t('onboarding.interestsTitle')}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {INTEREST_KEYS.map(key => {
        const isSelected = selected.has(key)
        return (
          <button key={key} type="button" aria-pressed={isSelected}
            onClick={() => onToggle(key)}
            style={{
              minHeight: 44, padding: '10px 18px', borderRadius: 99, fontSize: 14, fontWeight: 600,
              border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border)'}`,
              background: isSelected ? 'var(--brand-light)' : 'var(--white)',
              color: isSelected ? 'var(--link)' : 'var(--text2)',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
            }}>
            {/* Selected state conveyed by more than color alone — a visible
                checkmark, not just the border/background swap. */}
            {isSelected && <Check size={14} aria-hidden />}
            {t(`interest.${key}` as StringKey)}
          </button>
        )
      })}
    </div>
  )
}
