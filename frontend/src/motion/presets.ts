// src/motion/presets.ts — SP-5-02: ONE shared framer-motion preset module.
// Existing components (PostCard, AppShell, Home, ...) previously each wrote
// their own ad hoc spring/duration numbers — this centralizes the shared
// vocabulary so new and existing motion reads as one system. Values reuse
// the SP-5-01 --duration-*/--ease-* token scale's intent (fast/base/slow)
// translated into framer-motion's own transition shape.
import type { Transition, Variants } from 'framer-motion'

export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 500, damping: 30 }
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 300, damping: 28 }

// Press feedback — spread onto whileTap. No layout shift: scale only, never
// a size/padding change, so surrounding content never reflows on tap.
export const PRESS_TAP = { scale: 0.96 }

// Page/route entrance-exit. Deliberately no `mode="wait"` at the call site —
// old and new page cross-fade simultaneously so a route change is never
// delayed waiting for an exit animation to finish.
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}
export const pageTransition: Transition = { duration: 0.18, ease: [0.4, 0, 0.2, 1] }

// List/stagger entrance for feed-like lists.
export const listContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
}

// Tab-bar active-icon spring — same config AppShell's mobile nav already
// used ad hoc; centralized here so it's the one definition, not duplicated.
export const tabIndicatorTransition: Transition = SPRING_SNAPPY

// Like/reaction burst — small particles flying outward from the trigger.
// Pure visual data, no side effect: callers own their own mutation-guard
// state (PostCard already guards `reaction`/`reactionCount` locally), this
// only computes where the burst pieces go.
export function burstPieces(count = 6): Array<{ id: number; x: number; y: number }> {
  return [...Array(count)].map((_, i) => ({
    id: i,
    x: (i % 3 - 1) * 30,
    y: -(i * 12 + 20),
  }))
}
export const burstTransition: Transition = { duration: 0.6 }
