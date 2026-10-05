// src/utils/keyboardViewport.ts — is a software keyboard open? (UAT: the chat
// kept reserving the 72px bottom nav above an open keyboard, which hid the nav
// anyway). No device/UA/height constants: the visible height dropping well
// below the tallest height seen at this width, while an editable field has
// focus. A URL-bar show/hide (~50–60px) never crosses the threshold.
export const KEYBOARD_MIN_PX = 150

export function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'].includes(el.type)
  return (el as HTMLElement).isContentEditable === true
}

export function keyboardOpen(baselineHeight: number, visibleHeight: number, editableFocused: boolean): boolean {
  return editableFocused && baselineHeight - visibleHeight >= KEYBOARD_MIN_PX
}

// Installs one listener set; toggles `html.kb-open` (CSS hides the mobile bottom
// nav and its reserved padding) and emits `spandik:viewport` so layouts that
// size themselves to the visible area (ChatRoom) can refit after the toggle.
export function installKeyboardDetector(): () => void {
  const vv = window.visualViewport
  let width = window.innerWidth, baseline = vv?.height ?? window.innerHeight, open = false
  const update = () => {
    const h = vv?.height ?? window.innerHeight
    if (window.innerWidth !== width) { width = window.innerWidth; baseline = h }  // rotation / split screen
    const next = keyboardOpen(baseline, h, isEditable(document.activeElement))
    if (!next) baseline = Math.max(baseline, h)
    if (next !== open) { open = next; document.documentElement.classList.toggle('kb-open', open) }
    window.dispatchEvent(new Event('spandik:viewport'))
  }
  const evs: Array<[EventTarget, string]> = [[window, 'resize'], [window, 'orientationchange'], [document, 'focusin'], [document, 'focusout']]
  if (vv) evs.push([vv, 'resize'], [vv, 'scroll'])
  // focusin/out fire before the keyboard animates; the resize that follows decides.
  for (const [t, e] of evs) t.addEventListener(e, update)
  return () => { for (const [t, e] of evs) t.removeEventListener(e, update); document.documentElement.classList.remove('kb-open') }
}
