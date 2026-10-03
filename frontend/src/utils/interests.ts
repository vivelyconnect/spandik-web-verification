// src/utils/interests.ts — SP-11-01: frontend mirror of
// api/src/config/interests.ts's stable key list. Same reasoning as
// i18n/strings.ts's SUPPORTED_UI_LANGUAGES being its own frontend-owned
// list rather than fetched from the server — these are UI presentation
// keys (paired with interest.<key> translation strings), the server
// independently validates against its own canonical list on every write.
export const INTEREST_KEYS = [
  'technology',
  'music',
  'movies_entertainment',
  'cricket',
  'sports',
  'food',
  'travel',
  'books',
  'photography',
  'art_culture',
  'education',
  'business',
  'gaming',
  'fitness',
] as const

export type InterestKey = typeof INTEREST_KEYS[number]
