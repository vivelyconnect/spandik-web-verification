// src/components/ui/MentionInput.tsx
// Handles @ mention and # hashtag autocomplete in any text input
import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchApi, postApi, userApi } from '../../utils/api'
import Avatar from './Avatar'

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  style?: React.CSSProperties
  onSubmit?: () => void
  autoFocus?: boolean
}

interface Suggestion {
  type: 'user' | 'hashtag'
  id: string
  display: string
  sub?: string
  pic?: string | null
}

export default function MentionInput({
  value, onChange, placeholder, rows = 3, maxLength,
  style, onSubmit, autoFocus
}: MentionInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [trigger, setTrigger]     = useState<{ type: '@' | '#'; query: string; start: number } | null>(null)
  const [selected, setSelected]   = useState(0)
  const [showDrop, setShowDrop]   = useState(false)

  // SP-2-14: dedicated mention-suggestions endpoint (auth-required,
  // friends/followers-first, bilateral-block filtered) — not the global
  // /search, which has no "people you know" ordering and once leaked
  // private post text (SP-0-11R).
  const { data: userResults } = useQuery({
    queryKey: ['mention-users', trigger?.query],
    queryFn: () => userApi.mentionSuggestions(trigger!.query).then(r => r.data.data || []),
    enabled: trigger?.type === '@' && (trigger?.query?.length ?? 0) >= 1,
    staleTime: 5000,
  })

  // Search hashtags for # tags
  const { data: hashtagResults } = useQuery({
    queryKey: ['mention-hashtags', trigger?.query],
    queryFn: () => postApi.hashtag(trigger!.query).then(() =>
      searchApi.all(trigger!.query).then(r => r.data.data?.hashtags || [])
    ),
    enabled: trigger?.type === '#' && (trigger?.query?.length ?? 0) >= 1,
    staleTime: 5000,
  })

  const suggestions: Suggestion[] = trigger?.type === '@'
    ? (userResults || []).slice(0, 6).map((u: any) => ({
        type: 'user', id: u.username,
        display: `@${u.username}`,
        sub: `${u.first_name} ${u.last_name}`,
        pic: u.profile_pic_url,
      }))
    : (hashtagResults || []).slice(0, 6).map((h: any) => ({
        type: 'hashtag', id: h.tag,
        display: `#${h.tag}`,
        sub: `${h.post_count} posts`,
      }))

  useEffect(() => {
    setShowDrop(trigger !== null && suggestions.length > 0)
    setSelected(0)
  }, [suggestions.length, trigger])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text  = e.target.value
    const pos   = e.target.selectionStart || 0
    onChange(text)

    // Find if cursor is inside a @word or #word
    const before = text.slice(0, pos)
    const match  = before.match(/(?:^|\s)([@#])(\w*)$/)

    if (match) {
      const trigChar = match[1] as '@' | '#'
      const query    = match[2]
      const start    = before.lastIndexOf(match[1])
      setTrigger({ type: trigChar, query, start })
    } else {
      setTrigger(null)
      setShowDrop(false)
    }

    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  function insertSuggestion(s: Suggestion) {
    if (!trigger) return
    const before = value.slice(0, trigger.start)
    const after  = value.slice(trigger.start + trigger.query.length + 1)
    const insert = s.display + ' '
    onChange(before + insert + after)
    setTrigger(null)
    setShowDrop(false)
    // Refocus
    setTimeout(() => {
      if (ref.current) {
        const pos = (before + insert).length
        ref.current.focus()
        ref.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showDrop && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, suggestions.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertSuggestion(suggestions[selected])
        return
      }
      if (e.key === 'Escape') { setShowDrop(false); setTrigger(null) }
    } else if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        style={{
          width: '100%',
          background: 'var(--input-bg)',
          border: '1.5px solid var(--input-border)',
          borderRadius: 12,
          padding: '10px 14px',
          fontSize: 14,
          color: 'var(--text)',
          outline: 'none',
          resize: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.6,
          transition: 'border-color 0.15s',
          ...style,
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--brand)')}
        onBlur={e => {
          e.target.style.borderColor = 'var(--input-border)'
          setTimeout(() => setShowDrop(false), 200)
        }}
      />

      {/* Autocomplete dropdown */}
      {showDrop && suggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '100%', left: 0, right: 0,
          marginBottom: 4,
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          zIndex: 50,
          overflow: 'hidden',
          maxHeight: 240,
          overflowY: 'auto',
        }}>
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              onMouseDown={() => insertSuggestion(s)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', cursor: 'pointer',
                background: i === selected ? 'var(--brand-light)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={() => setSelected(i)}
            >
              {s.type === 'user' ? (
                <Avatar src={s.pic} name={s.sub || s.id} size={28} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--link)' }}>
                  #
                </div>
              )}
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{s.display}</div>
                {s.sub && <div style={{ fontSize: 11.5, color: 'var(--text4)' }}>{s.sub}</div>}
              </div>
            </div>
          ))}
          <div style={{ padding: '6px 14px', fontSize: 10.5, color: 'var(--text4)', borderTop: '1px solid var(--divider)', background: 'var(--bg2)' }}>
            ↑↓ navigate · Enter to select · Esc to close
          </div>
        </div>
      )}
    </div>
  )
}
