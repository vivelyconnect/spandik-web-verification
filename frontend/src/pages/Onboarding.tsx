// src/pages/Onboarding.tsx — SP-11-01: post-signup onboarding. A brand-new
// account lands here (see Register.tsx) after the existing Chat PIN/E2E
// setup + email-verify(-or-later) steps — never before them, so those
// security invariants are untouched. Server-authoritative throughout: every
// piece of state this page shows or gates on (completion, saved interests,
// real follow count) comes from GET /users/onboarding, never localStorage.
import { useState, useRef, useEffect } from 'react'
import { Check, PartyPopper } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { userApi, mediaApi } from '../utils/api'
import { useAuthStore } from '../stores/authStore'
import { useT } from '../i18n/useT'
import { SUPPORTED_UI_LANGUAGES } from '../i18n/strings'
import { compressImage } from '../utils/mediaCompress'
import { classifyAvatarFile } from '../utils/avatarCrop'
import AvatarCropDialog from '../components/ui/AvatarCropDialog'
import { syncOwnProfileImageCaches, invalidateOtherOwnAvatarCaches } from '../utils/profileCache'
import Avatar from '../components/ui/Avatar'
import InterestPicker from '../components/onboarding/InterestPicker'
import VerifyEmailPrompt from '../components/auth/VerifyEmailPrompt'

type Step = 'welcome' | 'interests' | 'language' | 'profile' | 'follow'
const STEPS: Step[] = ['welcome', 'interests', 'language', 'profile', 'follow']

const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '13px', minHeight: 44, borderRadius: 12, fontSize: 15, fontWeight: 700,
  background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', cursor: 'pointer',
}
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '13px', minHeight: 44, borderRadius: 12, fontSize: 15, fontWeight: 600,
  background: 'var(--bg2)', color: 'var(--text3)', border: '1px solid var(--border)', cursor: 'pointer',
}
const heading: React.CSSProperties = { fontFamily: 'Fraunces, serif', fontSize: 21, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }
const subheading: React.CSSProperties = { fontSize: 13.5, color: 'var(--text3)', marginBottom: 20, lineHeight: 1.5 }
const langBtn: React.CSSProperties = {
  padding: '13px 16px', minHeight: 44, borderRadius: 12, fontSize: 15, fontWeight: 600, textAlign: 'left',
  background: 'var(--white)', border: '1.5px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
}

function SuggestionRow({ user, followed, pending, onFollow }: { user: any; followed: boolean; pending: boolean; onFollow: () => void }) {
  const t = useT()
  const reasons: string[] = []
  if (user.interest_overlap > 0) reasons.push(t('onboarding.reasonSharesInterests'))
  if (user.recently_active) reasons.push(t('onboarding.reasonActive'))
  if (user.mutual_count > 0) {
    reasons.push(t(user.mutual_count === 1 ? 'onboarding.reasonMutual' : 'onboarding.reasonMutualPlural', { count: String(user.mutual_count) }))
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--white)' }}>
      <Avatar src={user.profile_pic_url} name={user.first_name} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{user.first_name} {user.last_name}</div>
        <div style={{ fontSize: 12, color: 'var(--text4)' }}>@{user.username}</div>
        {reasons.length > 0 && <div style={{ fontSize: 11, color: 'var(--link)', marginTop: 2 }}>{reasons.join(' · ')}</div>}
      </div>
      <button type="button" onClick={onFollow} disabled={followed || pending}
        style={{ minHeight: 40, padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 700, flexShrink: 0,
          background: followed ? 'var(--bg2)' : 'var(--btn-primary-bg)', color: followed ? 'var(--text4)' : 'var(--btn-primary-text)',
          border: followed ? '1px solid var(--border)' : 'none', cursor: followed ? 'default' : 'pointer' }}>
        {followed ? t('onboarding.followed') : t('onboarding.follow')}
      </button>
    </div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const t = useT()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)

  const [step, setStep] = useState<Step>('welcome')
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set())
  const [savingInterests, setSavingInterests] = useState(false)
  const [bio, setBio] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null) // SP-15-28
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set())
  const [followingInFlight, setFollowingInFlight] = useState<Set<string>>(new Set())
  const [completing, setCompleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const resumedRef = useRef(false)

  const { data: onboardingState, isLoading } = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => userApi.onboarding().then(r => r.data.data),
  })

  // Resume (Section 25): already-completed users never see this wizard —
  // sent straight back to Home. Already-saved interests pre-populate the
  // picker so a reload never loses progress.
  useEffect(() => {
    if (!onboardingState || resumedRef.current) return
    resumedRef.current = true
    if (onboardingState.completed) { navigate('/', { replace: true }); return }
    if (onboardingState.selected_interests?.length) {
      setSelectedInterests(new Set(onboardingState.selected_interests))
    }
  }, [onboardingState, navigate])

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['onboarding-suggestions'],
    queryFn: () => userApi.suggestions().then(r => r.data.data || []),
    enabled: step === 'follow' && !!user?.email_verified,
  })

  const serverFollowCount = onboardingState?.following_count ?? 0
  // Server truth plus this session's own just-followed accounts, so the
  // progress counter/Complete button update immediately without waiting on
  // a round-trip refetch (Section 40's cache-invalidation requirement).
  const liveFollowCount = Math.max(serverFollowCount, followedIds.size)

  function toggleInterest(key: string) {
    setSelectedInterests(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function saveInterestsAndAdvance() {
    if (selectedInterests.size === 0) { toast.error(t('onboarding.needMoreInterests')); return }
    setSavingInterests(true)
    try {
      await userApi.saveInterests([...selectedInterests])
      setStep('language')
    } catch { toast.error(t('onboarding.somethingWrong')) }
    finally { setSavingInterests(false) }
  }

  async function handleLanguageSelect(lang: string) {
    try {
      await userApi.update({ preferred_lang: lang })
      setUser({ preferred_lang: lang } as any)
    } catch { toast.error(t('onboarding.somethingWrong')) }
  }

  // SP-15-28: shared final step for both the crop dialog's output and the
  // GIF-passthrough path — same pattern as Profile.tsx's finishAvatarUpload.
  async function finishAvatarUpload(fileToUpload: File) {
    setUploadingPhoto(true)
    try {
      const res = await mediaApi.upload(fileToUpload, 'profile')
      const key = res.data.data.key
      await userApi.update({ profile_pic_key: key })
      const fresh = await userApi.me()
      setUser(fresh.data.data)
      syncOwnProfileImageCaches(qc, fresh.data.data)
      invalidateOtherOwnAvatarCaches(qc)
    } catch (err: any) { toast.error(err?.message || t('onboarding.somethingWrong')) }
    finally { setUploadingPhoto(false) }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const rejection = classifyAvatarFile(file)
    if (rejection?.kind === 'heic') {
      toast.error(t('profile.avatarHeicUnsupported'))
      return
    }
    if (rejection?.kind === 'gif') {
      try {
        setUploadingPhoto(true)
        const { file: compressed } = await compressImage(file)
        await finishAvatarUpload(compressed)
      } catch (err: any) { toast.error(err?.message || t('onboarding.somethingWrong')); setUploadingPhoto(false) }
      return
    }
    setCropFile(file) // opens AvatarCropDialog
  }

  async function handleAvatarCropped(cropped: File) {
    setCropFile(null)
    await finishAvatarUpload(cropped)
  }

  async function saveBioAndAdvance() {
    if (bio.trim()) {
      try { await userApi.update({ bio: bio.trim() }) }
      catch { toast.error(t('onboarding.somethingWrong')); return }
    }
    setStep('follow')
  }

  async function handleFollow(candidateId: string, username: string) {
    if (followedIds.has(candidateId) || followingInFlight.has(candidateId)) return
    // Marked "followed" only AFTER the real API call resolves — Section 41's
    // "no duplicate requests" and "reconcile with server" requirement: the
    // Complete button's own gate (liveFollowCount >= 3, below) must never
    // become enabled while a follow request is still genuinely in flight,
    // or completion could race ahead of the server actually recording it.
    // followingInFlight disables the button immediately for UI
    // responsiveness without lying about confirmed state.
    setFollowingInFlight(prev => new Set(prev).add(candidateId))
    try {
      await userApi.follow(username)
      setFollowedIds(prev => new Set(prev).add(candidateId))
      qc.invalidateQueries({ queryKey: ['onboarding'] })
    } catch {
      toast.error(t('onboarding.somethingWrong'))
    } finally {
      setFollowingInFlight(prev => { const next = new Set(prev); next.delete(candidateId); return next })
    }
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      await userApi.completeOnboarding()
      // Critical: OnboardingGate (mounted globally, App.tsx) holds its own
      // cached ['onboarding'] query — without invalidating it here too, its
      // still-stale `completed: false` immediately bounces the user right
      // back to /onboarding the instant this navigate below lands on '/'.
      await qc.invalidateQueries({ queryKey: ['onboarding'] })
      qc.invalidateQueries({ queryKey: ['feed'] })
      navigate('/', { replace: true })
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('onboarding.somethingWrong'))
    } finally { setCompleting(false) }
  }

  if (isLoading) {
    return <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text4)' }}>
      <div className="skeleton-bone" style={{ height: 20, width: 180, margin: '0 auto', borderRadius: 6 }} />
    </div>
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 60px', minHeight: '100vh' }}>
      {step !== 'welcome' && (
        <div role="progressbar" aria-valuenow={stepIndex} aria-valuemin={1} aria-valuemax={STEPS.length - 1}
          aria-label={t('onboarding.stepInterests')}
          style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {STEPS.slice(1).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i + 1 <= stepIndex ? 'var(--brand)' : 'var(--border)' }} />
          ))}
        </div>
      )}

      {step === 'welcome' && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <PartyPopper size={56} strokeWidth={1.5} aria-hidden style={{ marginBottom: 20, color: 'var(--link)' }} />
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 900, color: 'var(--text)', marginBottom: 10 }}>{t('onboarding.welcomeTitle')}</h1>
          <p style={{ color: 'var(--text3)', marginBottom: 32 }}>{t('onboarding.welcomeBody')}</p>
          <button type="button" onClick={() => setStep('interests')} style={primaryBtn}>{t('onboarding.getStarted')}</button>
        </div>
      )}

      {step === 'interests' && (
        <div>
          <h2 style={heading}>{t('onboarding.interestsTitle')}</h2>
          <p style={subheading}>{t('onboarding.interestsBody')}</p>
          <InterestPicker selected={selectedInterests} onToggle={toggleInterest} />
          <div style={{ marginTop: 28 }}>
            <button type="button" onClick={saveInterestsAndAdvance} disabled={savingInterests} style={primaryBtn}>{t('onboarding.next')}</button>
          </div>
        </div>
      )}

      {step === 'language' && (
        <div>
          <h2 style={heading}>{t('onboarding.languageTitle')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28, marginTop: 20 }}>
            {SUPPORTED_UI_LANGUAGES.map(({ code, label }) => {
              const isSelected = user?.preferred_lang === code
              return (
                <button key={code} type="button" aria-pressed={isSelected}
                  onClick={() => handleLanguageSelect(code)}
                  style={{ ...langBtn, borderColor: isSelected ? 'var(--brand)' : 'var(--border)', color: isSelected ? 'var(--link)' : 'var(--text2)' }}>
                  {isSelected && <Check size={14} aria-hidden style={{ verticalAlign: '-2px' }} />} {label}
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => setStep('profile')} style={primaryBtn}>{t('onboarding.next')}</button>
        </div>
      )}

      {step === 'profile' && (
        <div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
          {cropFile && (
            <AvatarCropDialog file={cropFile} onCancel={() => setCropFile(null)} onCropped={handleAvatarCropped} />
          )}
          <h2 style={heading}>{t('onboarding.photoTitle')}</h2>
          <p style={subheading}>{t('onboarding.photoBody')}</p>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <button type="button" onClick={() => fileRef.current?.click()} aria-label={t('onboarding.photoTitle')}
              style={{ cursor: 'pointer', display: 'inline-block', background: 'none', border: 'none', padding: 0 }}>
              <Avatar src={user?.profile_pic_url} name={user?.first_name || 'U'} size={96} />
            </button>
            {uploadingPhoto && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text4)' }}>{t('onboarding.completing')}</div>}
          </div>
          <h2 style={heading}>{t('onboarding.bioTitle')}</h2>
          <p style={subheading}>{t('onboarding.bioBody')}</p>
          <textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 200))} placeholder={t('onboarding.bioPlaceholder')}
            aria-label={t('onboarding.bioTitle')}
            style={{ width: '100%', minHeight: 80, padding: 12, borderRadius: 10, border: '1.5px solid var(--input-border)', fontSize: 14, marginBottom: 20, resize: 'vertical', background: 'var(--input-bg)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => setStep('follow')} style={secondaryBtn}>{t('onboarding.skip')}</button>
            <button type="button" onClick={saveBioAndAdvance} style={{ ...primaryBtn, flex: 1, width: 'auto' }}>{t('onboarding.next')}</button>
          </div>
        </div>
      )}

      {step === 'follow' && (
        <div>
          <h2 style={heading}>{t('onboarding.followTitle')}</h2>
          <p style={subheading}>{t('onboarding.followBody')}</p>

          {!user?.email_verified ? (
            <>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>{t('onboarding.verifyRequiredTitle')}</p>
              <VerifyEmailPrompt message={t('onboarding.verifyRequiredBody')} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--link)', marginBottom: 16 }}>
                {t('onboarding.followProgress', { count: String(Math.min(liveFollowCount, 3)) })}
              </div>
              {suggestionsLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                  {[0, 1, 2].map(i => <div key={i} className="skeleton-bone" style={{ height: 64, borderRadius: 14 }} />)}
                </div>
              ) : suggestions?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                  {suggestions.map((u: any) => (
                    <SuggestionRow key={u.id} user={u} followed={followedIds.has(u.id)} pending={followingInFlight.has(u.id)} onFollow={() => handleFollow(u.id, u.username)} />
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text4)', fontSize: 13 }}>{t('onboarding.noSuggestions')}</div>
              )}
              <button type="button" onClick={handleComplete} disabled={completing || liveFollowCount < 3} style={primaryBtn}>
                {completing ? t('onboarding.completing') : t('onboarding.complete')}
              </button>
              {liveFollowCount < 3 && <div style={{ fontSize: 12, color: 'var(--text4)', marginTop: 8, textAlign: 'center' }}>{t('onboarding.needMoreFollows')}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
