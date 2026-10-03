// src/components/layout/Footer.tsx — SP-5-16 corporate attribution,
// SP-5-18 two-register wording split.
// Desktop/web app layouts + legal pages only — never inside the chat room,
// feed cards, or any dense content surface (see AppShell.tsx's own
// `.desktop-footer` CSS class for the mobile-hide rule on the app-shell use).
//
// Two wordings, two registers (locked, SP-5-18): product chrome (AppShell)
// uses the short "from Vively" form; legal surfaces use the full
// "© year Vively Technology Solutions..." entity line — never the same
// string in both places.
import { useT } from '../../i18n/useT'

export default function Footer({ variant = 'legal' }: { variant?: 'legal' | 'app' }) {
  const t = useT()
  if (variant === 'app') {
    return (
      <footer style={{ padding: '12px 24px 20px', textAlign: 'center', fontSize: 11.5, color: 'var(--text4)' }}>
        {t('brand.attributionShort')}
      </footer>
    )
  }
  return (
    <footer style={{ padding: '20px 24px', textAlign: 'center', fontSize: 12, color: 'var(--text4)' }}>
      © {new Date().getFullYear()} · {t('brand.attribution')}
    </footer>
  )
}
