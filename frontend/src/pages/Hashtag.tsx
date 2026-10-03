// src/pages/Hashtag.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { Hash } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { postApi } from '../utils/api'
import PostCard from '../components/post/PostCard'
import { useT } from '../i18n/useT'

export default function Hashtag() {
  const { tag } = useParams<{ tag: string }>()
  const navigate = useNavigate()
  const t = useT()
  const { data: posts, isLoading } = useQuery({
    queryKey: ['hashtag', tag],
    queryFn: () => postApi.hashtag(tag!).then(r => r.data.data),
    enabled: !!tag,
  })
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>#{tag}</h1>
        {posts && <div style={{ fontSize: 13, color: 'var(--text4)', marginTop: 2 }}>{t('hashtag.postCount', { count: String(posts.length) })}</div>}
      </div>
      {isLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text4)' }}>{t('feed.loading')}</div>}
      {!isLoading && posts?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Hash size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12, color: 'var(--text4)' }} />
          <div style={{ color: 'var(--text4)', marginBottom: 20 }}>{t('hashtag.noPosts', { tag: tag! })}</div>
          <button onClick={() => navigate('/explore')}
            style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
            {t('feed.exploreSpandik')}
          </button>
        </div>
      )}
      {posts?.map((post: any) => <PostCard key={post.id} post={post} />)}
    </div>
  )
}
