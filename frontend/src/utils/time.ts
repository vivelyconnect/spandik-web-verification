// src/utils/time.ts — the one place API timestamps become instants.
//
// The API returns two shapes: ISO-8601 with an explicit zone ("…T…Z", written
// by app code via nowISO) and SQLite's datetime('now') default,
// "YYYY-MM-DD HH:MM:SS" — UTC, but with no zone marker (notifications, posts,
// stories, comments, device activity…). `new Date()` reads that second shape
// as the viewer's LOCAL time, so in India a just-created notification showed
// as "5h ago". Zone-less API timestamps are UTC by contract; this treats them
// so, in every timezone, without any per-zone offset.
const ZONELESS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/

// Milliseconds since the epoch, or NaN for a missing/malformed value.
export function parseApiTime(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return NaN
  const s = value.trim()
  const m = ZONELESS.exec(s)
  return Date.parse(m ? `${m[1]}T${m[2]}Z` : s)
}

// Age of an API timestamp in ms (never negative — a small clock skew between
// device and server reads as "just now"), or NaN when it can't be parsed.
export function apiAgeMs(value: unknown, now: number = Date.now()): number {
  const t = parseApiTime(value)
  return Number.isNaN(t) ? NaN : Math.max(0, now - t)
}
