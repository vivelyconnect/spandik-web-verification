// src/motion/haptics.ts — SP-5-02: feature-detected, failure-safe haptic
// wrapper. Only ever call this from a direct user-action handler (a click,
// a tap, a drag release) — never from a passive/background event (poll,
// websocket push, timer) per the task's own hard rule.
export function hapticTap(pattern: number | number[] = 8): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
    }
  } catch {
    // Some browsers throw for a vibrate() call outside a user gesture —
    // never let a decorative haptic break the action it's attached to.
  }
}
