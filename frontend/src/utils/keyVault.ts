// src/utils/keyVault.ts — Wave 3B (reviewer Option B): the chat private key is
// never persisted in plaintext. Each account gets a NON-EXTRACTABLE WebCrypto
// AES-GCM-256 wrapping key kept in IndexedDB (stored as a CryptoKey: script on
// this origin can use it, but nothing can read its bytes out); web storage
// holds only AES-GCM ciphertext whose additional authenticated data binds it
// to the account, the key's public half and its role.
//
// Defence in depth for data at rest (storage dumps, synced/backed-up web
// storage, a copied localStorage). It does NOT stop code running inside the
// signed-in page (XSS, a malicious extension or build), which can use the key
// just like the app does — and it adds no forward secrecy.
//
// No IndexedDB (some private modes): the wrapping key lives only in memory, so
// the wrapped blob cannot be opened after a reload — the user restores with
// their Chat PIN / key again. Plaintext is never the fallback.
const DB_NAME = 'spandik-keyvault'
const STORE = 'wrap-keys'

export interface Wrapped { v: 1; iv: string; ct: string }

const memWrapKeys = new Map<string, CryptoKey>()
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
}

function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return openDb().then(db => db ? new Promise<T | undefined>(resolve => {
    try {
      const req = op(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => { resolve(req.result as T); db.close() }
      req.onerror = () => { resolve(undefined); db.close() }
    } catch { resolve(undefined); db.close() }
  }) : undefined)
}

async function wrapKeyFor(userId: string, create: boolean): Promise<CryptoKey | null> {
  const cached = memWrapKeys.get(userId)
  if (cached) return cached
  const stored = await idb<CryptoKey>('readonly', s => s.get(userId))
  if (stored) { memWrapKeys.set(userId, stored); return stored }
  if (!create) return null
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  memWrapKeys.set(userId, key)
  await idb('readwrite', s => s.put(key, userId))
  return key
}

const aad = (userId: string, context: string) => new TextEncoder().encode(`spandik-chat-key|v1|${userId}|${context}`)

// `context` names what is wrapped, e.g. `current|<publicKeyB64>` or
// `history|<version>|<publicKeyB64>` — a blob can't be swapped into another slot.
export async function wrapSecret(userId: string, context: string, secret: Uint8Array): Promise<Wrapped> {
  const key = (await wrapKeyFor(userId, true))!
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, context) }, key, secret as BufferSource))
  return { v: 1, iv: b64(iv), ct: b64(ct) }
}

// null = cannot open (wrapping key gone, wrong slot/account, tampered).
export async function unwrapSecret(userId: string, context: string, w: Wrapped | undefined): Promise<Uint8Array | null> {
  if (!w || w.v !== 1) return null
  const key = await wrapKeyFor(userId, false)
  if (!key) return null
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: aad(userId, context) }, key, unb64(w.ct)))
  } catch { return null }
}

// Whether wrapping keys survive a reload here (IndexedDB usable).
export async function vaultIsDurable(): Promise<boolean> {
  const db = await openDb()
  db?.close()
  return !!db
}

export async function forgetWrapKey(userId: string): Promise<void> {
  memWrapKeys.delete(userId)
  await idb('readwrite', s => s.delete(userId))
}
