// src/motion/PullToRefresh.tsx — SP-5-02: the ONE pull-to-refresh
// implementation in the app (grepped first — no prior implementation
// existed to reuse). "Spandan" (heartbeat) pulse in the brand gradient
// while refreshing. Window-scroll-based (this app's pages scroll the
// document, not an inner container — confirmed in Home.tsx), touch-only
// (pull-to-refresh is a mobile gesture; desktop has no equivalent trigger).
import { useRef, useState, type ReactNode } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useDecorativeMotionEnabled } from './prefs'
import { useT } from '../i18n/useT'

const THRESHOLD = 64

export default function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown> | void; children: ReactNode }) {
  const t = useT()
  const decorative = useDecorativeMotionEnabled()
  const startY = useRef<number | null>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  function onTouchStart(e: React.TouchEvent) {
    if (refreshing || window.scrollY > 0) { startY.current = null; return }
    startY.current = e.touches[0].clientY
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0) setPull(Math.min(dy * 0.4, THRESHOLD * 1.5))
  }
  async function onTouchEnd() {
    if (startY.current === null) return
    startY.current = null
    if (pull >= THRESHOLD) {
      setRefreshing(true)
      setPull(THRESHOLD)
      try { await onRefresh() } finally { setRefreshing(false); setPull(0) }
    } else {
      setPull(0)
    }
  }

  const indicatorHeight = refreshing ? 40 : pull

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* Screen-reader announcement — the visual pulse alone is decorative
          and skipped entirely under reduced-motion/Data Saver, but the
          refresh itself always happens, so this must not depend on it. */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {refreshing ? t('feed.refreshing') : ''}
      </div>
      <AnimatePresence>
        {indicatorHeight > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: indicatorHeight }}
            exit={{ opacity: 0, height: 0 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            <motion.div
              animate={decorative && (refreshing || pull >= THRESHOLD) ? { scale: [1, 1.3, 1] } : { scale: 1 }}
              transition={decorative ? { duration: 0.6, repeat: refreshing ? Infinity : 0, ease: 'easeInOut' } : { duration: 0 }}
              style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--btn-brand-bg)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  )
}
