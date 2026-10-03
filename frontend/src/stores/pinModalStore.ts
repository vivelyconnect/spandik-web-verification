// src/stores/pinModalStore.ts — lets Settings/ChatRoom (mounted per-route)
// manually trigger the single PinModal instance mounted once at App root.
import { create } from 'zustand'

interface PinModalState {
  open: boolean
  // Bumped whenever keys are restored anywhere, so any component that reads
  // hasKeys(userId) at render time can subscribe to this and re-render live
  // instead of only picking up the change on next mount/navigation.
  keysVersion: number
  openPinModal: () => void
  closePinModal: () => void
  notifyKeysRestored: () => void
}

export const usePinModalStore = create<PinModalState>((set) => ({
  open: false,
  keysVersion: 0,
  openPinModal: () => set({ open: true }),
  closePinModal: () => set({ open: false }),
  notifyKeysRestored: () => set(s => ({ open: false, keysVersion: s.keysVersion + 1 })),
}))
