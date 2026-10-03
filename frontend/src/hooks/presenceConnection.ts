// src/hooks/presenceConnection.ts — SP-3-01 remediation.
//
// Pure, framework-free connection-lifecycle controller for the global
// presence WebSocket, extracted out of usePresence.ts. Two real defects in
// the original inline implementation motivated this:
//
// 1. `ws.close()` (called both from the 5-minute background timer and the
//    browser `offline` handler) always ran through the same `onclose`
//    handler, which unconditionally called `scheduleReconnect()` whenever
//    `cancelled` was false — so backgrounding or going offline immediately
//    scheduled a reconnect attempt instead of suppressing one. `onclose`
//    now checks background/offline state before scheduling anything.
// 2. There was no guard against overlapping triggers (a fired reconnect
//    timer, a foreground event and an online event landing in the same
//    tick) opening more than one socket, and no protection against an
//    older socket's asynchronously-delivered `onclose` acting on state that
//    a newer connection attempt has since replaced.
//
// This class is deliberately React-free (no hooks, no DOM references
// baked in — visibility/online/offline are reported to it via explicit
// method calls) so the actual state machine can be driven with fake timers
// directly in Node. This project's vitest setup has no DOM environment (no
// jsdom/testing-library — see mediaCompress.test.ts), so testing this
// logic through the real hook + real `document`/`window` isn't an option
// without adding new tooling; extracting the orchestration avoids needing
// to.

// Server-side online TTL is 300s (chat-worker's UserPresence DO) — 60s
// heartbeats refresh it with a comfortable 5x safety margin.
export const HEARTBEAT_MS = 60000
// A connection that hasn't heard a pong in 2 missed heartbeats is treated
// as dead (network black hole, e.g. a laptop waking from sleep with a
// half-open TCP connection) and force-closed to trigger reconnect.
export const STALE_AFTER_MS = HEARTBEAT_MS * 2
export const MAX_BACKOFF_MS = 30000
// Backgrounded longer than this closes the socket outright rather than
// leaving a heartbeat running in a tab nobody's looking at — matches the
// SP-3-01 acceptance requirement, not an arbitrary choice.
export const BACKGROUND_CLOSE_MS = 5 * 60 * 1000

export function backoffWithJitter(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS)
  // Equal jitter: half fixed, half random — bounds the minimum delay (no
  // near-zero retries hammering the server) while still spreading a large
  // batch of simultaneously-reconnecting clients apart (reconnect-storm
  // prevention after a shared outage).
  return base / 2 + Math.random() * (base / 2)
}

// The minimal shape both the real browser WebSocket and a test double
// satisfy — lets tests inject a fake without needing a DOM/WebSocket
// polyfill.
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onclose: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onerror: (() => void) | null
}

const WS_CONNECTING = 0
const WS_OPEN = 1

export interface PresenceConnectionDeps {
  mintTicket: () => Promise<string>
  createSocket: (url: string) => SocketLike
  wsUrl: string
  onConnectedChange?: (connected: boolean) => void
  // SP-3-02: fired for every parsed server frame that isn't the internal
  // `pong` handshake — e.g. a live-pushed `{type:'notification',...}`
  // event. Deliberately untyped/unvalidated here — this controller stays
  // framework- and business-logic-free; the caller (usePresence.ts, then
  // AppShell.tsx) owns defensive parsing and what to actually do with it.
  onServerEvent?: (msg: unknown) => void
}

export class PresenceConnection {
  private deps: PresenceConnectionDeps
  private cancelled = false
  private backgroundSuspended = false
  private offline = false
  private connecting = false
  private socket: SocketLike | null = null
  // Bumped on every new connect() attempt. A socket's event handlers close
  // over the generation they were created for — if `this.generation` has
  // since moved on (a newer connect() replaced it) by the time a handler
  // fires, the handler is for a superseded socket and must do nothing.
  // This is what makes an older socket's asynchronously-delivered `onclose`
  // safe even after a newer connection has already taken over `this.socket`.
  private generation = 0
  private reconnectAttempts = 0
  private lastPongAt = Date.now()
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private backgroundTimer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: PresenceConnectionDeps) {
    this.deps = deps
  }

  /** Call once to begin the first connection attempt. */
  start(): void {
    void this.connect()
  }

  /** Permanent shutdown (logout, effect unmount) — no further reconnects, ever. */
  stop(): void {
    this.cancelled = true
    clearTimeout(this.backgroundTimer)
    this.backgroundTimer = undefined
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    this.socket?.close()
    this.socket = null
    this.setConnected(false)
  }

  /** Tab went to background (document.visibilityState === 'hidden'). */
  onHidden(): void {
    if (this.backgroundTimer) return // already counting down
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = undefined
      this.backgroundSuspended = true
      // Suppress any reconnect that might already be scheduled — entering
      // suspension must never leave a pending timer that fires later and
      // opens a socket while still backgrounded.
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
      this.socket?.close()
    }, BACKGROUND_CLOSE_MS)
  }

  /** Tab returned to foreground (document.visibilityState === 'visible'). */
  onVisible(): void {
    if (this.backgroundTimer) {
      // The 5-minute timer never actually fired — a short visibility
      // flicker (tab switch, screen lock/unlock) must not churn the
      // connection at all.
      clearTimeout(this.backgroundTimer)
      this.backgroundTimer = undefined
      return
    }
    if (this.backgroundSuspended) {
      this.backgroundSuspended = false
      this.reconnectAttempts = 0
      void this.connect()
    }
  }

  /** Browser fired a real `offline` event. */
  onOffline(): void {
    this.offline = true
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close()
  }

  /** Browser fired a real `online` event. */
  onOnline(): void {
    if (!this.offline) return
    this.offline = false
    this.reconnectAttempts = 0
    void this.connect()
  }

  private setConnected(v: boolean): void {
    this.deps.onConnectedChange?.(v)
  }

  // Prevents a new connection when: a connect() is already in flight, the
  // current socket is CONNECTING or OPEN, the controller is cancelled, the
  // tab is background-suspended, or the browser is offline.
  private canStartConnect(): boolean {
    if (this.cancelled || this.backgroundSuspended || this.offline || this.connecting) return false
    if (this.socket && (this.socket.readyState === WS_OPEN || this.socket.readyState === WS_CONNECTING)) return false
    return true
  }

  private scheduleReconnect(): void {
    // Never schedule a reconnect while suspended/offline/cancelled — this
    // is the core fix: entering background or going offline must not leave
    // a pending timer that later opens a socket while still suppressed.
    if (this.cancelled || this.backgroundSuspended || this.offline) return
    const delay = backoffWithJitter(this.reconnectAttempts)
    this.reconnectAttempts++
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }

  private async connect(): Promise<void> {
    if (!this.canStartConnect()) return
    // Set synchronously, before the first await — a second call landing in
    // the same tick (e.g. onVisible() and onOnline() both firing) sees this
    // immediately and bails, guaranteeing only one socket per race.
    this.connecting = true
    const myGen = ++this.generation

    let ticket: string
    try {
      ticket = await this.deps.mintTicket()
    } catch {
      this.connecting = false
      if (myGen !== this.generation) return
      this.scheduleReconnect()
      return
    }

    this.connecting = false
    // State may have changed while the mint call was in flight (logout,
    // backgrounded, went offline, or — defensively — a newer attempt
    // somehow started) — never open a socket into a state that no longer
    // wants one.
    if (this.cancelled || this.backgroundSuspended || this.offline || myGen !== this.generation) return

    const socket = this.deps.createSocket(`${this.deps.wsUrl}?ticket=${ticket}`)
    this.socket = socket

    socket.onopen = () => {
      if (myGen !== this.generation) { socket.close(); return }
      this.reconnectAttempts = 0
      this.lastPongAt = Date.now()
      this.setConnected(true)
      // Defensive: clear any pre-existing interval before creating a new
      // one so a reconnect race can never leave two heartbeats running.
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = setInterval(() => {
        if (myGen !== this.generation) { clearInterval(this.heartbeatTimer); return }
        if (Date.now() - this.lastPongAt > STALE_AFTER_MS) {
          // Dead connection — no pong in 2 heartbeat windows. Close it;
          // onclose below decides whether to reconnect.
          socket.close()
          return
        }
        if (socket.readyState === WS_OPEN) socket.send(JSON.stringify({ type: 'ping' }))
      }, HEARTBEAT_MS)
    }
    socket.onmessage = (event) => {
      if (myGen !== this.generation) return
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'pong') { this.lastPongAt = Date.now(); return }
        this.deps.onServerEvent?.(msg)
      } catch { /* ignore malformed frames */ }
    }
    socket.onclose = () => {
      // A superseded generation's close must never touch current state —
      // this is what makes a stale socket's delayed onclose harmless even
      // after a newer connection has already replaced it.
      if (myGen !== this.generation) return
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
      this.socket = null
      this.setConnected(false)
      if (this.cancelled || this.backgroundSuspended || this.offline) return
      this.scheduleReconnect()
    }
    socket.onerror = () => socket.close()
  }
}
