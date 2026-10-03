// src/pages/Saved.tsx
import { useQuery } from '@tanstack/react-query'
import { Bookmark } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { postApi } from '../utils/api'
import PostCard from '../components/post/PostCard'
import { useT } from '../i18n/useT'

export default function Saved() {
  const navigate = useNavigate()
  const t = useT()
  const { data: posts, isLoading } = useQuery({
    queryKey: ['saved'],
    queryFn: () => postApi.saved().then(r => r.data.data),
  })

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 24px' }}>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 20 }}>{t('saved.title')}</h1>
      {isLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text4)' }}>{t('feed.loading')}</div>}
      {!isLoading && posts?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Bookmark size={48} strokeWidth={1.5} aria-hidden style={{ marginBottom: 16, color: 'var(--text4)' }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{t('saved.emptyTitle')}</div>
          <div style={{ color: 'var(--text4)', marginBottom: 20 }}>{t('saved.emptyBody')}</div>
          <button onClick={() => navigate('/')}
            style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
            {t('feed.exploreSpandik')}
          </button>
        </div>
      )}
      {posts?.map((post: any) => <PostCard key={post.id} post={post} />)}
    </div>
  )
}
