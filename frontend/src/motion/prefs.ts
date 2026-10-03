// src/motion/prefs.ts — SP-5-02: shared motion-preference plumbing so every
// consumer (presets, PullToRefresh, CelebrationBurst, per-component motion)
// reads the same two signals instead of re-deriving them.
import { useEffect, useState } from 'react'
import { useDataSaverStore } from '../stores/dataSaverStore'
import { useEasyMode } from '../stores/authStore'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

// Pure decision logic, extracted so it's testable without a DOM/React
// render (this project's vitest setup has no jsdom/testing-library — see
// e.g. hooks/usePresence.test.ts's own header comment for the convention).
export function decorativeMotionEnabled(reducedMotion: boolean, dataSaver: boolean, easyMode = false): boolean {
  return !reducedMotion && !dataSaver && !easyMode
}

// Decorative motion = anything purely delightful rather than needed to
// understand state (celebration bursts, pull-to-refresh heartbeat, particle
// bursts). Disabled under OS reduced-motion, Data Saver, OR Easy Mode
// (SP-5-07 — calmer, simpler UI for people who asked for it).
export function useDecorativeMotionEnabled(): boolean {
  const reduced = usePrefersReducedMotion()
  const dataSaver = useDataSaverStore(s => s.enabled)
  const easyMode = useEasyMode()
  return decorativeMotionEnabled(reduced, dataSaver, easyMode)
}
