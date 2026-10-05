// src/utils/chatScroll.ts — pure rules for the chat message list's scroll
// position (UAT: a thread opened mid-history; load-older jumped to the bottom;
// any new message yanked a reader out of older history).
export interface ListShape { first: string | null; last: string | null; count: number; lastMine: boolean }

export function shapeOf<T extends { id: string; sender_id?: string }>(msgs: T[], myId: string | undefined): ListShape {
  const last = msgs[msgs.length - 1]
  return { first: msgs[0]?.id ?? null, last: last?.id ?? null, count: msgs.length, lastMine: !!last && last.sender_id === myId }
}

// initial: first messages of this thread appeared → pin to the newest, instantly.
// prepend: older history loaded above → keep the visible anchor.
// append: newer message(s) at the end (live, own send, reconnect catch-up).
// update: same ends (tombstone, seen receipt, decrypt-in-place) → layout only.
export type ListChange = 'initial' | 'prepend' | 'append' | 'update'
export function classifyChange(prev: ListShape, next: ListShape): ListChange {
  if (prev.count === 0 && next.count > 0) return 'initial'
  if (next.first !== prev.first && next.last === prev.last && next.count > prev.count) return 'prepend'
  if (next.last !== prev.last && next.count >= prev.count) return 'append'
  return 'update'
}

// "At the bottom" with a little slack (a partial last row, rounding).
export const NEAR_BOTTOM_PX = 64
export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX
}

// After rows are prepended, the same content stays under the reader's eye.
export function prependAnchorTop(oldScrollHeight: number, oldScrollTop: number, newScrollHeight: number): number {
  return oldScrollTop + (newScrollHeight - oldScrollHeight)
}

// Whether an appended message should move the view to the bottom: only when
// the reader was already there, or it is their own just-sent message.
export function followsAppend(pinned: boolean, lastMine: boolean): boolean {
  return pinned || lastMine
}
