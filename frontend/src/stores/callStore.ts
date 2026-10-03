// src/stores/callStore.ts — SP-3-05: transient (never persisted) global
// call-control state, fed exclusively by AppShell's single presence
// WebSocket handler (see hooks/incomingCall.ts's defensive parsers). Two
// independent consumers read from this store: IncomingCallOverlay.tsx (the
// full-screen ring UI, driven by `incoming`) and Connect.tsx (the caller's
// own screen, driven by `resolved` to learn when its outgoing call was
// accepted/declined/cancelled/missed on the server side — never invented
// client-side).
import { create } from 'zustand'
import type { IncomingCallEvent, CallResolvedEvent } from '../hooks/incomingCall'

interface CallState {
  incoming: IncomingCallEvent | null
  resolved: CallResolvedEvent | null
  setIncoming: (e: IncomingCallEvent | null) => void
  setResolved: (e: CallResolvedEvent | null) => void
}

export const useCallStore = create<CallState>((set, get) => ({
  incoming: null,
  resolved: null,
  setIncoming: (e) => set({ incoming: e }),
  setResolved: (e) => {
    // A resolved event always dismisses a currently-ringing incoming
    // overlay for the SAME call, on every device — this is what makes
    // "accept on device 1 dismisses device 2" and "cancel/decline/timeout
    // clears the ringing screen" work without each consumer re-deriving it.
    const current = get().incoming
    set({ resolved: e, incoming: current && e && current.call_id === e.call_id ? null : current })
  },
}))
