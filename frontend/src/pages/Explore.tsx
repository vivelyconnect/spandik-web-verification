// src/pages/Explore.tsx
import { useState } from 'react'
import { Search, SearchX, TrendingUp, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { m as motion } from 'framer-motion'
import { searchApi, postApi, userApi } from '../utils/api'
import Avatar from '../components/ui/Avatar'
import VerifiedBadge from '../components/ui/VerifiedBadge'
import PostCard from '../components/post/PostCard'
import { useT } from '../i18n/useT'

export default function Explore() {
  const [q, setQ]     = useState('')
  const [focused, setFocused] = useState(false)
  const navigate = useNavigate()
  const t = useT()

  const { data: trending } = useQuery({
    queryKey: ['trending-hashtags'],
    queryFn: () => postApi.trending().then(r => r.data.data),
  })

  const { data: suggestions } = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => userApi.suggestions().then(r => r.data.data),
  })

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.all(q).then(r => r.data.data),
    enabled: q.length >= 2,
  })

  const { data: explorePosts } = useQuery({
    queryKey: ['explore'],
    queryFn: () => postApi.explore().then(r => r.data.data),
    enabled: q.length < 2,
  })

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 24px' }}>
      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={18} aria-hidden style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text4)' }} />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={t('explore.searchPlaceholder')}
          style={{ width: '100%', padding: '12px 14px 12px 40px', background: 'var(--white)', border: `1.5px solid ${focused ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 99, fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxShadow: focused ? '0 0 0 3px var(--brand-light)' : 'var(--shadow-sm)', transition: 'all 0.15s' }} />
        {q && <button onClick={() => setQ('')} aria-label={t('explore.clearSearch')}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} aria-hidden /></button>}
      </div>

      {q.length >= 2 ? (
        /* Search results */
        <div>
          {searching && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text4)' }}>{t('explore.searching')}</div>}

          {searchResults?.users?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <SectionTitle>{t('explore.people')}</SectionTitle>
              {searchResults.users.map((u: any) => (
                <UserRow key={u.id} user={u} onClick={() => navigate(`/u/${u.username}`)} />
              ))}
            </div>
          )}

          {searchResults?.hashtags?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <SectionTitle>{t('explore.hashtags')}</SectionTitle>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {searchResults.hashtags.map((h: any) => (
                  <motion.button key={h.tag} whileTap={{ scale: 0.95 }}
                    onClick={() => navigate(`/tag/${h.tag}`)}
                    style={{ padding: '7px 14px', minHeight: 44, borderRadius: 99, background: 'var(--brand-light)', color: 'var(--link)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    #{h.tag} <span style={{ fontWeight: 400, opacity: 0.7 }}>({h.post_count})</span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {searchResults?.posts?.length > 0 && (
            <div>
              <SectionTitle>{t('explore.posts')}</SectionTitle>
              {searchResults.posts.map((p: any) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          )}

          {searchResults && !searchResults.users?.length && !searchResults.hashtags?.length && !searchResults.posts?.length && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text4)' }}>
              <SearchX size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>{t('explore.noResults', { q })}</div>
              <button onClick={() => setQ('')}
                style={{ padding: '10px 22px', minHeight: 44, borderRadius: 99, fontSize: 13, fontWeight: 700, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer' }}>
                {t('explore.clearSearch')}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Discovery view */
        <div>
          {/* Trending hashtags */}
          {trending?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><TrendingUp size={16} aria-hidden />{t('explore.trendingInIndia')}</span></SectionTitle>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {trending.slice(0, 10).map((h: any, i: number) => (
                  <motion.button key={h.tag} whileTap={{ scale: 0.95 }}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    onClick={() => navigate(`/tag/${h.tag}`)}
                    style={{ minHeight: 44, padding: '8px 16px', borderRadius: 99, background: 'var(--white)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', boxShadow: 'var(--shadow-sm)' }}>
                    #{h.tag}
                    <span style={{ fontSize: 11, color: 'var(--text4)', marginLeft: 4 }}>{h.post_count}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Suggested users */}
          {suggestions?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle>{t('explore.peopleYouMayKnow')}</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {suggestions.slice(0, 5).map((u: any) => (
                  <UserRow key={u.id} user={u} onClick={() => navigate(`/u/${u.username}`)}
                    mutual={u.mutual_count > 0 ? t('explore.mutualCount', { count: String(u.mutual_count) }) : undefined} />
                ))}
              </div>
            </div>
          )}

          {/* Explore posts */}
          <SectionTitle>{t('explore.explorePosts')}</SectionTitle>
          {explorePosts?.map((post: any) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text3)', marginBottom: 10 }}>{children}</div>
}

function UserRow({ user, onClick, mutual }: { user: any; onClick: () => void; mutual?: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{ width: '100%', textAlign: 'left', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', background: 'var(--white)', border: '1px solid var(--border)', marginBottom: 6 }}>
      <Avatar src={user.profile_pic_url} name={user.first_name} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{user.first_name} {user.last_name}</div>
        <div style={{ fontSize: 12, color: 'var(--text4)' }}>@{user.username}{mutual ? ` · ${mutual}` : ''}</div>
      </div>
      {/* SP-5-08: /search sends the raw D1 0/1 integer here — the shared
          badge's strict check means an unverified user no longer renders a
          stray "0" (which `{0 && ...}` did). */}
      <VerifiedBadge verified={user.is_verified_badge} />
    </button>
  )
}
