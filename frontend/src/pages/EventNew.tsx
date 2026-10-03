// src/pages/EventNew.tsx — SP-9-01: self-service event creation.
// Radical-simplicity form (UI Law 2): one screen, plain-language fields,
// native <input type="date"/"time"> instead of a picker library.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { eventApi, mediaApi } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../i18n/useT'
import { compressImage } from '../utils/mediaCompress'
import VerifyEmailPrompt from '../components/auth/VerifyEmailPrompt'

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', background: 'var(--input-bg)',
  border: '1.5px solid var(--input-border)', borderRadius: 10, fontSize: 14,
  color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
}

function Err({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{children}</div>
}

export default function EventNew() {
  const t = useT()
  const user = useAuthStore(s => s.user)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [location, setLocation] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { file: compressed } = await compressImage(file)
      setCoverFile(compressed)
      setCoverPreview(URL.createObjectURL(compressed))
    } catch (err: any) {
      toast.error(err?.message || t('event.photoError'))
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim() || title.trim().length < 3 || title.trim().length > 120) {
        throw new Error(t('event.titleRequired'))
      }
      if (!startDate || !startTime) throw new Error(t('event.startRequired'))
      const starts_at = new Date(`${startDate}T${startTime}`).toISOString()
      if (new Date(starts_at).getTime() < Date.now()) throw new Error(t('event.startInPast'))
      const ends_at = endDate && endTime ? new Date(`${endDate}T${endTime}`).toISOString() : undefined

      let cover_media_key: string | undefined
      if (coverFile) {
        const res = await mediaApi.upload(coverFile, 'event')
        cover_media_key = res.data.data?.key
      }

      const res = await eventApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        cover_media_key,
        starts_at,
        ends_at,
        is_online: isOnline,
        location: location.trim() || undefined,
      })
      return res.data.data as { id: string; slug: string }
    },
    onSuccess: (data) => {
      toast.success(t('event.created'))
      // SP-9-02 will add a real in-app "my events" list; for now the created
      // event's own public page (on the marketing domain) IS the confirmation.
      window.location.href = `https://spandik.com/e/${data.slug}`
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || t('event.createFailed')
      setError(msg)
      toast.error(msg)
    },
  })

  if (user && !user.email_verified) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '60px 20px' }}>
        <p style={{ color: 'var(--text2)', textAlign: 'center', marginBottom: 16 }}>{t('event.emailNotVerified')}</p>
        <VerifyEmailPrompt />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 900, color: 'var(--text)', marginBottom: 20 }}>
        {t('event.createEvent')}
      </h1>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>{t('event.coverPhoto')}</label>
        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 160, borderRadius: 14, border: '1.5px dashed var(--input-border)',
          background: coverPreview ? `url(${coverPreview}) center/cover no-repeat` : 'var(--bg2)',
          cursor: 'pointer', overflow: 'hidden',
        }}>
          {!coverPreview && <span style={{ fontSize: 13, color: 'var(--text4)' }}>+ {t('event.coverPhoto')}</span>}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} />
        </label>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>{t('event.title')}</label>
        <input style={inputStyle} value={title} maxLength={120}
          placeholder={t('event.titlePlaceholder')} onChange={e => setTitle(e.target.value)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>{t('event.description')}</label>
        <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={description} maxLength={3000}
          placeholder={t('event.descriptionPlaceholder')} onChange={e => setDescription(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>{t('event.startsAt')}</label>
          <input type="date" style={inputStyle} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label style={{ ...labelStyle, opacity: 0 }}>·</label>
          <input type="time" style={inputStyle} value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>{t('event.endsAt')}</label>
          <input type="date" style={inputStyle} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div>
          <label style={{ ...labelStyle, opacity: 0 }}>·</label>
          <input type="time" style={inputStyle} value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={isOnline} onChange={e => setIsOnline(e.target.checked)} />
        <span style={{ fontSize: 13.5, color: 'var(--text2)' }}>{t('event.onlineEvent')}</span>
      </label>

      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>{t('event.location')}</label>
        <input style={inputStyle} value={location}
          placeholder={isOnline ? t('event.onlineLocationPlaceholder') : t('event.locationPlaceholder')}
          onChange={e => setLocation(e.target.value)} />
      </div>

      {error && <Err>{error}</Err>}

      <button
        disabled={create.isPending}
        onClick={() => create.mutate()}
        style={{
          width: '100%', padding: '14px', borderRadius: 99, fontSize: 15, fontWeight: 700,
          background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none',
          cursor: create.isPending ? 'default' : 'pointer', opacity: create.isPending ? 0.7 : 1,
        }}>
        {create.isPending ? t('event.creating') : t('event.createEvent')}
      </button>
    </div>
  )
}
