// src/hooks/usePresence.ts — SP-3-01: one global presence WebSocket per
// authenticated session, mounted once from AppShell. Independent from
// per-chat ChatRoom sockets (useChat.ts) — this connects to
// chat-worker's /presence route (UserPresence DO), not /chat/thread/:id.
//
// The actual connection state machine (background/offline suppression,
// duplicate-connect guarding, stale-socket handling) lives in
// presenceConnection.ts as a framework-free controller — this hook is just
// the thin React/DOM wiring around it. See that file's header comment for
// why it's split out this way.
import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { presenceApi } from '../utils/api'
import { PresenceConnection, type SocketLike } from './presenceConnection'

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || 'wss://chat.spandik.com'

export {
  HEARTBEAT_MS, STALE_AFTER_MS, MAX_BACKOFF_MS, BACKGROUND_CLOSE_MS, backoffWithJitter,
} from './presenceConnection'

// SP-3-02: `onServerEvent`, when provided, is called for every non-pong
// frame the presence socket receives (e.g. a live-pushed notification) —
// kept in a ref so passing a fresh inline function every render never tears
// down and reopens the WebSocket (the effect below still only depends on
// `userId`).
export function usePresence(onServerEvent?: (msg: unknown) => void) {
  const userId = useAuthStore(s => s.user?.id)
  const [connected, setConnected] = useState(false)
  const onServerEventRef = useRef(onServerEvent)
  onServerEventRef.current = onServerEvent

  useEffect(() => {
    if (!userId) return

    const controller = new PresenceConnection({
      mintTicket: async () => {
        const res = await presenceApi.wsTicket()
        return res.data.data.ticket
      },
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      wsUrl: `${CHAT_WS_URL}/presence`,
      onConnectedChange: setConnected,
      onServerEvent: (msg) => onServerEventRef.current?.(msg),
    })
    controller.start()

    function handleVisibility() {
      if (document.visibilityState === 'hidden') controller.onHidden()
      else controller.onVisible()
    }
    function handleOffline() { controller.onOffline() }
    function handleOnline() { controller.onOnline() }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      controller.stop()
    }
  }, [userId])

  return { connected }
}
