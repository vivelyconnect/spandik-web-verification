// src/components/ui/Overlay.tsx — SP-5-04: the ONE responsive overlay/sheet
// primitive in the app. Mobile: bottom sheet. Desktop (>=768px, matching
// the app's existing header breakpoint — see index.html's .desktop-header/
// .mobile-header toggle): centered dialog. Applied to ShareSheet, PostCard's
// reaction picker, PostCard's post-options menu, and — SP-5-19 — the
// AppShell.tsx create-post composer, which previously used its own
// hand-rolled fixed `alignItems:'flex-end'` backdrop that opened below the
// fold on tall desktop viewports.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useT } from '../../i18n/useT'

// Same 768px breakpoint the rest of the app already uses (index.html's
// .desktop-header/.mobile-header toggle) — computed here in JS rather than
// via a CSS class + media query so the mobile-sheet-vs-desktop-dialog
// choice is unambiguous and directly verifiable, not dependent on cascade
// order surviving Tailwind's CSS pipeline untouched.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  ariaLabel: string
  closeOnEscape?: boolean
  maxWidth?: number
  showCloseButton?: boolean
  /** SP-5-19: optional passthrough so a caller's own Playwright/testing
   * selector can find the panel — e.g. the composer's pre-existing
   * `[data-testid="composer-modal"]`, relied on by 37/38's own specs.
   * Never used for styling/behavior, generic across every Overlay caller. */
  testId?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export default function Overlay({ open, onClose, children, ariaLabel, closeOnEscape = true, maxWidth = 480, showCloseButton = true, testId }: OverlayProps) {
  const t = useT()
  const isDesktop = useIsDesktop()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Bundle SP5-A independent-review remediation: `onClose`/`closeOnEscape`
  // are read through refs, updated every render, rather than being
  // dependencies of the open-session effect below. Callers commonly pass
  // an inline `onClose={() => setShowX(false)}` — a new function identity
  // on every render of the caller. If the effect depended on it directly,
  // any unrelated state change while the dialog is open (e.g. toggling an
  // owner switch inside post-options) would tear down and re-run the
  // effect: unlock body scroll, restore focus to the original trigger,
  // then immediately re-lock and re-focus the panel — a visible focus
  // jump, exactly the bug this fixes. Refs give the keydown handler the
  // latest callback without the effect itself needing to restart.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeOnEscapeRef = useRef(closeOnEscape)
  closeOnEscapeRef.current = closeOnEscape

  // Runs exactly once per open session (mounts on open:false->true, tears
  // down on open:true->false) — never for any other reason, so an
  // internal re-render never resets focus or re-toggles the scroll lock
  // while the dialog is still open.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the panel itself first (predictable even if it has no
    // focusable child yet), then hand off to the first real focusable
    // element inside it, if one exists.
    panelRef.current?.focus()
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && closeOnEscapeRef.current) { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) { e.preventDefault(); return }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      // No trapped focus after close — hand it back to whatever opened this.
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150,
            display: 'flex', justifyContent: 'center',
            alignItems: isDesktop ? 'center' : 'flex-end',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            ref={panelRef}
            data-testid={testId}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            initial={isDesktop ? { opacity: 0, scale: 0.96 } : { y: '100%' }}
            animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, scale: 0.96 } : { y: '100%' }}
            transition={isDesktop ? { duration: 0.15 } : { type: 'spring', stiffness: 400, damping: 35 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth,
              background: 'var(--white)',
              borderRadius: isDesktop ? 20 : '20px 20px 0 0',
              maxHeight: '85vh', overflowY: 'auto',
              padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
              outline: 'none',
              position: 'relative',
            }}
          >
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label={t('overlay.close')}
                style={{
                  position: 'absolute', top: 10, right: 10, zIndex: 1,
                  width: 44, height: 44, minWidth: 44, minHeight: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontSize: 18, color: 'var(--text4)',
                }}
              >
                <X size={20} aria-hidden />
              </button>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
