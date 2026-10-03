// src/components/ui/ErrorBoundary.tsx — SP-2-07: catches a thrown render
// error and shows a friendly fallback instead of a white screen. React only
// supports this via a class component (componentDidCatch/getDerivedStateFromError
// have no hook equivalent) — no library needed for this little code.
import { Component, type ReactNode } from 'react'
import { translate, type Lang } from '../../i18n/strings'

// SP-5-06: content sourced from the shared i18n module (not `useT()` — a
// render-error boundary can't rely on hooks/store access being safe at the
// point it's catching an error, and `lang` already arrives as a prop here).
// translate() falls back to English if that dictionary isn't loaded.
const copy = (lang: Lang) => ({
  title: translate(lang, 'error.title'), body: translate(lang, 'error.body'), reload: translate(lang, 'error.reload'),
})

interface Props { lang?: string; children: ReactNode }
interface State { hasError: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[RENDER ERROR]', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const l = this.props.lang
    const c = copy(l === 'hi' || l === 'bn' ? l : 'en')
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{c.title}</div>
          <div style={{ color: 'var(--text4)', marginBottom: 28 }}>{c.body}</div>
          <button onClick={() => window.location.reload()}
            style={{ minHeight: 44, padding: '12px 28px', borderRadius: 99, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
            {c.reload}
          </button>
        </div>
      </div>
    )
  }
}
