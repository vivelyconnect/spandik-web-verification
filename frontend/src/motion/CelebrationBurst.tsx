// src/motion/CelebrationBurst.tsx — SP-5-02: confetti-lite delight moment
// for first-post/first-friend milestones. Pure framer-motion (no new
// dependency, no canvas/particle library). Mounted once in App.tsx, driven
// by useCelebrationStore — never a second competing overlay implementation.
import { useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { useDecorativeMotionEnabled } from './prefs'

const COLORS = ['#FF9F1C', '#F43F75', '#7C3AED']
const PIECES = 14
const DURATION_MS = 900

export default function CelebrationBurst({ show, onDone }: { show: boolean; onDone: () => void }) {
  const decorative = useDecorativeMotionEnabled()

  // Reduced-motion / Data Saver: skip the visual entirely but still resolve
  // onDone so the caller's own toast/state isn't left waiting on an
  // animation that will never play.
  useEffect(() => {
    if (!show) return
    const t = setTimeout(onDone, decorative ? DURATION_MS : 0)
    return () => clearTimeout(t)
  }, [show, decorative, onDone])

  return (
    <AnimatePresence>
      {show && decorative && (
        <motion.div
          aria-hidden="true"
          data-testid="celebration-burst"
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 300 }}
          exit={{ opacity: 0 }}
        >
          {[...Array(PIECES)].map((_, i) => {
            const angle = (i / PIECES) * Math.PI * 2
            const dist = 70 + (i % 3) * 26
            return (
              <motion.span
                key={i}
                data-testid="celebration-piece"
                initial={{ opacity: 1, x: 0, y: 0, scale: 0 }}
                animate={{ opacity: 0, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.015 }}
                style={{
                  position: 'absolute', top: '35%', left: '50%',
                  width: 8, height: 8, borderRadius: 2,
                  background: COLORS[i % COLORS.length],
                }}
              />
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
