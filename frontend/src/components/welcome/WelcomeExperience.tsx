// src/components/welcome/WelcomeExperience.tsx — SP-5-11: a short
// post-login "title sequence". Hard rules (master plan): <=2.5s total,
// fresh login only (never on reload/app open/tab focus), tap/click/any key
// skips, and a static gradient + greeting fallback (shorter, no motion)
// under prefers-reduced-motion, Data Saver, Easy Mode, or a low-end
// device/network. The feed loads underneath the whole time — this never
// gates data or navigation. Lightweight: layered CSS gradients + the
// existing framer-motion; the Spandik mark is the unmodified app icon.
import { useEffect, useRef } from 'react'
import { m as motion } from 'framer-motion'
import { useT } from '../../i18n/useT'
import type { StringKey } from '../../i18n/strings'

export const CINEMATIC_MS = 2400
export const STATIC_MS = 1500
const FLAG = 'spandik_welcome_pending'

// Login.tsx calls this right before navigating into the app; the shell
// consumes it once. sessionStorage (not localStorage): one tab's fresh
// login, cleared as soon as it is shown, so a reload never replays it.
export function markFreshLogin() {
  try { sessionStorage.setItem(FLAG, '1') } catch {}
}
export function consumeFreshLogin(): boolean {
  try {
    if (sessionStorage.getItem(FLAG) !== '1') return false
    sessionStorage.removeItem(FLAG)
    return true
  } catch { return false }
}

export interface WelcomeSignals {
  reducedMotion: boolean
  dataSaver: boolean
  easyMode: boolean
  deviceMemory?: number
  saveData?: boolean
  effectiveType?: string
}

// Pure: which variant plays. Anything that asks for less motion/data, or a
// device/network that would stutter, gets the static fallback.
export function welcomeMode(s: WelcomeSignals): 'cinematic' | 'static' {
  const lowEnd = (s.deviceMemory !== undefined && s.deviceMemory <= 2)
    || !!s.saveData
    || s.effectiveType === 'slow-2g' || s.effectiveType === '2g'
  return s.reducedMotion || s.dataSaver || s.easyMode || lowEnd ? 'static' : 'cinematic'
}

// Pure: time-of-day greeting (the viewer's own local time).
export function greetingKey(hour: number): StringKey {
  if (hour >= 5 && hour < 12) return 'welcome.morning'
  if (hour >= 12 && hour < 17) return 'welcome.afternoon'
  if (hour >= 17 && hour < 21) return 'welcome.evening'
  return 'welcome.back'
}

export default function WelcomeExperience({ name, mode, onDone }: {
  name: string; mode: 'cinematic' | 'static'; onDone: () => void
}) {
  const t = useT()
  const done = useRef(false)
  const finish = () => { if (!done.current) { done.current = true; onDone() } }
  const total = mode === 'cinematic' ? CINEMATIC_MS : STATIC_MS

  useEffect(() => {
    const timer = setTimeout(finish, total)
    const onKey = () => finish()
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  const cinematic = mode === 'cinematic'
  return (
    <motion.div data-testid="welcome-experience" data-mode={mode}
      role="status" aria-live="polite" onPointerDown={finish}
      initial={{ opacity: 1 }}
      animate={cinematic ? { opacity: [1, 1, 0] } : { opacity: 1 }}
      transition={cinematic ? { duration: total / 1000, times: [0, 0.82, 1] } : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
        padding: 24, textAlign: 'center', color: '#fff',
        background: 'var(--btn-brand-bg)', backgroundSize: '200% 200%',
      }}>
      {/* "Silk": a second, softly drifting gradient layer — CSS only. */}
      {cinematic && (
        <motion.div aria-hidden="true"
          initial={{ backgroundPosition: '0% 50%' }} animate={{ backgroundPosition: '100% 50%' }}
          transition={{ duration: total / 1000, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.28), transparent 45%), radial-gradient(circle at 70% 70%, rgba(36,27,67,0.35), transparent 50%)', backgroundSize: '200% 200%', pointerEvents: 'none' }} />
      )}
      <motion.img src="/brand/spandik-app-icon-192.png" alt="" aria-hidden="true" width={88} height={88}
        initial={cinematic ? { scale: 0.6, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ borderRadius: 22, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', position: 'relative' }} />
      <motion.div initial={cinematic ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: cinematic ? 0.55 : 0, duration: 0.45 }}
        style={{ position: 'relative', fontSize: 26, fontWeight: 800, textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
        {t(greetingKey(new Date().getHours()), { name })}
      </motion.div>
      <motion.div initial={cinematic ? { opacity: 0 } : false} animate={{ opacity: 0.9 }}
        transition={{ delay: cinematic ? 0.9 : 0, duration: 0.4 }}
        style={{ position: 'relative', fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>
        {t('brand.attributionShort')}
      </motion.div>
      <span style={{ position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))', fontSize: 12, opacity: 0.8 }}>
        {t('welcome.tapToSkip')}
      </span>
    </motion.div>
  )
}
