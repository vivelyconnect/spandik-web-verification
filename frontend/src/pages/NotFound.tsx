// src/pages/NotFound.tsx
import { useNavigate } from 'react-router-dom'
import { m as motion } from 'framer-motion'
import { useT } from '../i18n/useT'

export default function NotFound() {
  const navigate = useNavigate()
  const t = useT()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 80, fontWeight: 900, color: 'var(--link)', lineHeight: 1 }}>404</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 8, marginBottom: 8 }}>{t('notFound.title')}</div>
        <div style={{ color: 'var(--text4)', marginBottom: 28 }}>{t('notFound.body')}</div>
        <button onClick={() => navigate('/')}
          style={{ padding: '12px 28px', minHeight: 44, borderRadius: 99, fontSize: 14, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
          {t('notFound.goHome')}
        </button>
      </motion.div>
    </div>
  )
}
