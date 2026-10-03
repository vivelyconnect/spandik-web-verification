// src/pwa/PwaBanners.tsx — SP-5-09: offline banner, "new version ready"
// (the safe, user-confirmed service-worker update), and the install card
// (second visit on, snoozable; never on iOS/unsupported browsers).
import { usePwaStore, useIsOffline, useSessionRecovering, applyUpdate, promptInstall, dismissInstall, shouldOfferInstall, installOfferState } from './pwa'
import { useT } from '../i18n/useT'

const BAR: React.CSSProperties = {
  position: 'fixed', left: 12, right: 12, zIndex: 90, margin: '0 auto', maxWidth: 520,
  bottom: 'calc(76px + env(safe-area-inset-bottom))',
  background: 'var(--white)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 14,
  boxShadow: 'var(--shadow-lg)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14,
}
const BTN: React.CSSProperties = {
  minHeight: 44, padding: '0 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontWeight: 700,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', whiteSpace: 'nowrap',
}
const GHOST: React.CSSProperties = { ...BTN, background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)' }

export default function PwaBanners() {
  const t = useT()
  const online = !useIsOffline()
  const recovering = useSessionRecovering()
  const updateReady = usePwaStore(s => s.updateReady)
  const installEvent = usePwaStore(s => s.installEvent)
  const offer = installOfferState()
  const showInstall = online && !updateReady && shouldOfferInstall(offer.visits, offer.dismissedAt, Date.now(), !!installEvent, offer.standalone)

  if (online && recovering) {
    return (
      <div role="status" data-testid="reconnecting-banner" style={{ ...BAR, background: 'var(--sidebar-bg)', color: '#fff', border: 'none' }}>
        <span aria-hidden="true">●</span><span style={{ flex: 1 }}>{t('pwa.reconnecting')}</span>
      </div>
    )
  }
  if (!online) {
    return (
      <div role="status" data-testid="offline-banner" style={{ ...BAR, background: 'var(--sidebar-bg)', color: '#fff', border: 'none' }}>
        <span aria-hidden="true">●</span><span style={{ flex: 1 }}>{t('pwa.offline')}</span>
      </div>
    )
  }
  if (updateReady) {
    return (
      <div role="status" data-testid="update-banner" style={BAR}>
        <span style={{ flex: 1 }}>{t('pwa.updateReady')}</span>
        <button type="button" style={BTN} onClick={applyUpdate}>{t('pwa.refresh')}</button>
      </div>
    )
  }
  if (showInstall) {
    return (
      <div role="dialog" aria-label={t('pwa.installTitle')} data-testid="install-card" style={BAR}>
        <img src="/brand/spandik-app-icon-96.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{t('pwa.installTitle')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{t('pwa.installBody')}</div>
        </div>
        <button type="button" style={GHOST} onClick={dismissInstall}>{t('pwa.notNow')}</button>
        <button type="button" style={BTN} onClick={promptInstall}>{t('pwa.install')}</button>
      </div>
    )
  }
  return null
}
