// src/utils/e2e.ts — E2E encryption using tweetnacl
import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'
import { KDF_V3_TAG, OprfError, newV3Key, v3Key, v3VersionOf, type OprfContext } from './pinOprf'
import { wrapSecret, unwrapSecret, forgetWrapKey, vaultIsDurable, type Wrapped } from './keyVault'

const KEYS_PREFIX = 'spandik_e2e_'

// SP-0-07: KDF versioning. New passphrase-derived keys are tagged with this
// prefix on the salt string itself (no DB column needed — the tag travels
// wherever the salt already does, locally and in the server backup). A salt
// with no recognized prefix is a pre-SP-0-07 legacy salt.
export const KDF_VERSION = 'pbkdf2-sha256-310k'
// SP-14-01/02: KDF v3 = Argon2id(OPRF(PIN)) (utils/pinOprf.ts). Every new or
// re-wrapped PIN backup uses it; v1 (legacy) and v2 (PBKDF2) still restore.
export { KDF_V3_TAG, OprfError }
const PBKDF2_ITERATIONS = 310_000

export interface KeyBundle {
  identity_key: string
}

interface StoredKeys {
  public_key: string
  private_key_encrypted: string
  private_key_nonce: string
  has_passphrase: boolean
  // Option B (Wave 3B): the device's key, AES-GCM-wrapped (utils/keyVault.ts).
  sk_wrapped?: Wrapped
  // Legacy plaintext — only ever READ, to migrate it (unlockLocalKeys).
  private_key_plain?: string
}
type StoredFields = Pick<StoredKeys, 'private_key_encrypted' | 'private_key_nonce' | 'has_passphrase'>

export function hasKeys(userId: string): boolean {
  return !!localStorage.getItem(`${KEYS_PREFIX}${userId}`)
}

function getStored(userId: string): StoredKeys | null {
  const raw = localStorage.getItem(`${KEYS_PREFIX}${userId}`)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ── Option B: the device key is wrapped at rest, unwrapped only into memory ──
// Synchronous readers (getPrivateKey / getHistoricalPrivateKeys) see a key only
// after unlockLocalKeys() has run on this page load — ensureE2EKeys, PinModal
// and useChat all await it first.
const memKeys = new Map<string, Uint8Array>()
const memPub = new Map<string, string>() // public half of memKeys' entry (cheap staleness check)
const memHistory = new Map<string, Array<{ key_version: number; private_key: Uint8Array }>>()
const currentSlot = (pk: string) => `current|${pk}`
const historySlot = (v: number, pk: string) => `history|${v}|${pk}`
const pubOf = (sk: Uint8Array) => encodeBase64(nacl.box.keyPair.fromSecretKey(sk).publicKey)

// encrypt → verify the round trip → only then replace the stored entry (one write).
async function storeLocalKey(userId: string, sk: Uint8Array, fields: StoredFields): Promise<void> {
  const pk = pubOf(sk)
  const w = await wrapSecret(userId, currentSlot(pk), sk)
  const back = await unwrapSecret(userId, currentSlot(pk), w)
  if (!back || encodeBase64(back) !== encodeBase64(sk)) throw new Error('Chat key wrap could not be verified')
  localStorage.setItem(`${KEYS_PREFIX}${userId}`, JSON.stringify({ ...fields, public_key: pk, sk_wrapped: w }))
  memKeys.set(userId, sk); memPub.set(userId, pk)
}

async function storeHistory(userId: string, entries: Array<{ key_version: number; public_key: string; private_key: Uint8Array }>): Promise<void> {
  const out: Array<{ key_version: number; public_key: string; sk_wrapped: Wrapped }> = []
  for (const e of entries) {
    const w = await wrapSecret(userId, historySlot(e.key_version, e.public_key), e.private_key)
    const back = await unwrapSecret(userId, historySlot(e.key_version, e.public_key), w)
    if (!back || encodeBase64(back) !== encodeBase64(e.private_key)) throw new Error('History key wrap could not be verified')
    out.push({ key_version: e.key_version, public_key: e.public_key, sk_wrapped: w })
  }
  localStorage.setItem(historyStorageKey(userId), JSON.stringify(out))
  memHistory.set(userId, entries.map(e => ({ key_version: e.key_version, private_key: e.private_key })))
}

// Loads this device's key (and key history) into memory. Migrates a legacy
// plaintext entry: wrap → verify → replace, and only when the wrapping key is
// durably stored (otherwise this page load just uses it, untouched — never
// strand a key that may have no other copy). A wrapped entry that can no
// longer be opened (site data partly cleared) is dropped so the app asks for
// the Chat PIN / key again. Returns whether a usable key is now in memory.
export async function unlockLocalKeys(userId: string): Promise<boolean> {
  const stored = getStored(userId)
  // Cached only while the stored entry still names the same key (another tab
  // may have reset/replaced it).
  if (memKeys.has(userId) && stored?.public_key === memPub.get(userId)) return true
  memKeys.delete(userId); memHistory.delete(userId)
  if (!stored?.public_key) return false
  const { public_key, sk_wrapped, private_key_plain, private_key_encrypted, private_key_nonce, has_passphrase } = stored
  let sk: Uint8Array | null = null
  if (sk_wrapped) {
    sk = await unwrapSecret(userId, currentSlot(public_key), sk_wrapped)
  } else if (private_key_plain) {
    sk = decodeBase64(private_key_plain)
    if (pubOf(sk) === public_key && await vaultIsDurable()) {
      try { await storeLocalKey(userId, sk, { private_key_encrypted, private_key_nonce, has_passphrase }) } catch { /* keep the legacy entry; retry next load */ }
    }
  }
  if (!sk || pubOf(sk) !== public_key) { clearE2EKeys(userId); return false }
  memKeys.set(userId, sk); memPub.set(userId, public_key)
  await unlockHistory(userId)
  return true
}

async function unlockHistory(userId: string): Promise<void> {
  let raw: any[] = []
  try { raw = JSON.parse(localStorage.getItem(historyStorageKey(userId)) || '[]') } catch { return }
  const entries: Array<{ key_version: number; public_key: string; private_key: Uint8Array }> = []
  let legacy = false
  for (const h of raw) {
    const sk = h.sk_wrapped ? await unwrapSecret(userId, historySlot(h.key_version, h.public_key), h.sk_wrapped)
      : h.private_key_plain ? (legacy = true, decodeBase64(h.private_key_plain)) : null
    if (sk) entries.push({ key_version: h.key_version, public_key: h.public_key, private_key: sk })
  }
  memHistory.set(userId, entries.map(e => ({ key_version: e.key_version, private_key: e.private_key })))
  if (legacy && await vaultIsDurable()) await storeHistory(userId, entries).catch(() => {})
}

// Legacy KDF (10k-round SHA-512 loop) — kept ONLY so passphrase backups created
// before SP-0-07 can still be decrypted. Never used for new backups.
// Exported for e2e.test.ts's KDF test vectors (SP-0-16d) — not used outside this module.
export function deriveKeyLegacy(passphrase: string, salt: Uint8Array): Uint8Array {
  const encoder = new TextEncoder()
  let key: Uint8Array = encoder.encode(passphrase)
  for (let i = 0; i < 10000; i++) {
    const combined = new Uint8Array(key.length + salt.length)
    combined.set(key)
    combined.set(salt, key.length)
    key = nacl.hash(combined)
  }
  return key.slice(0, 32)
}

// Current KDF: WebCrypto PBKDF2-SHA256, 310k iterations (OWASP 2023+ baseline).
export async function deriveKeyPBKDF2(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  )
  return new Uint8Array(bits)
}

// Generates a new v2 (PBKDF2) salt. Since SP-14-02 only tests create v2
// backups (as the "existing pre-OPRF backup" fixture); real flows use v3.
export function newVersionedSalt(): string {
  return `${KDF_VERSION}:${encodeBase64(nacl.randomBytes(16))}`
}

// Derives a key from a stored salt field, using whichever KDF that salt was
// tagged with. Only a genuinely untagged salt (no ':' at all — pre-SP-0-07
// data) falls back to the legacy KDF. SP-0-16d: a salt that IS tagged but
// with a version we don't recognize must fail closed (throw), not silently
// downgrade to the weak legacy KDF — a corrupted or substituted version tag
// must never be able to force weak key derivation.
// v3 needs the server's blind OPRF evaluation, hence `oprf` (one context per
// operation and PIN, so several entries cost one counted guess).
export async function deriveKeyFromSaltField(passphrase: string, saltField: string, oprf?: OprfContext): Promise<Uint8Array> {
  const sep = saltField.indexOf(':')
  if (sep === -1) return deriveKeyLegacy(passphrase, decodeBase64(saltField))
  const version = saltField.slice(0, sep)
  if (version === KDF_V3_TAG) {
    if (!oprf) throw new Error('KDF v3 needs a signed-in session')
    return v3Key(passphrase, saltField.slice(sep + 1), oprf)
  }
  const salt = decodeBase64(saltField.slice(sep + 1))
  if (version === KDF_VERSION) return deriveKeyPBKDF2(passphrase, salt)
  throw new Error(`Unsupported KDF version: ${version}`)
}

// The `kdf` label the server records next to a backup (informational; the
// salt field's own tag is what derivation trusts).
function kdfLabelOf(saltField: string): string {
  return v3VersionOf(saltField) !== null ? KDF_V3_TAG : KDF_VERSION
}

// SP-14-02 migration: a backup still needs re-wrapping if it predates KDF v3
// or names an OPRF seed version older than the server's current one.
export function backupNeedsUpgrade(saltField: string | null | undefined, currentOprfVersion: number | null | undefined): boolean {
  if (!saltField || !currentOprfVersion) return false
  const v = v3VersionOf(saltField)
  return v === null || v < currentOprfVersion
}

export async function initE2ENoPassphrase(userId: string): Promise<KeyBundle> {
  const keypair = nacl.box.keyPair()
  await storeLocalKey(userId, keypair.secretKey, { private_key_encrypted: '', private_key_nonce: '', has_passphrase: false })
  return buildBundle(keypair.publicKey)
}

export function getMyPublicKey(userId: string): string | null {
  return getStored(userId)?.public_key || null
}

// ── SP-1-08: trust-on-first-use key pinning ────────────────────
// Basic protection against server-side key substitution: the first time
// this device ever sees a contact's identity key, it's pinned locally.
// Any later mismatch means the server started handing back a different
// key for that contact — could be a legitimate new phone, could be a
// substitution attack. Either way, never silently trust it (full
// safety-number verification UX is SP-6-04 — this is the basic version
// required before public v1).
const PIN_PREFIX = 'spandik_e2e_pin_'

export function getPinnedKey(myUserId: string, contactId: string): string | null {
  return localStorage.getItem(`${PIN_PREFIX}${myUserId}_${contactId}`)
}

export function pinKey(myUserId: string, contactId: string, publicKeyB64: string): void {
  localStorage.setItem(`${PIN_PREFIX}${myUserId}_${contactId}`, publicKeyB64)
}

// The unwrapped key, if unlockLocalKeys() has loaded it on this page load.
export function getPrivateKey(userId: string): Uint8Array | null {
  return memKeys.has(userId) && getStored(userId)?.public_key === memPub.get(userId) ? memKeys.get(userId)! : null
}

// SP-1-04: does this device's cached key come from an unencrypted server
// backup? If so, the account needs the "secure your chats" migration prompt.
export function hasPassphrase(userId: string): boolean {
  return !!getStored(userId)?.has_passphrase
}

export function clearE2EKeys(userId: string): void {
  localStorage.removeItem(`${KEYS_PREFIX}${userId}`)
  localStorage.removeItem(`${KEYS_PREFIX}${userId}_salt`)
  localStorage.removeItem(`${KEYS_PREFIX}${userId}_history`)
  memKeys.delete(userId); memPub.delete(userId)
  memHistory.delete(userId)
  forgetWrapKey(userId).catch(() => {})
}

// Logout (Wave 3A step 4): remove this device's copy only when a server
// backup can bring it back; an unprotected key is the only copy and stays.
export function clearLocalChatKeys(userId: string): void {
  if (getStored(userId)?.has_passphrase) clearE2EKeys(userId)
}


// Module-level promise so useChat can wait for key init to complete
let _ensurePromise: Promise<void> = Promise.resolve()
let _running = false

export function getEnsureE2EKeysPromise(): Promise<void> {
  return _ensurePromise
}

// Called silently on login/register/app-open — ensures every user has keys registered.
// Concurrent calls are collapsed: if already running, return the in-flight promise.
// Passphrase is NOT needed here — passphrase is an optional upgrade to protect
// the key backup stored on the server.
export function ensureE2EKeys(userId: string, accessToken: string): Promise<void> {
  if (getPrivateKey(userId)) return Promise.resolve() // fast path — usable keys already done
  if (_running) return _ensurePromise             // already in flight, share the promise
  _running = true
  const promise = _doEnsureE2EKeys(userId, accessToken).finally(() => { _running = false })
  _ensurePromise = promise
  return promise
}

// Fetch the server-side key backup. Returns 'protected' (encrypted — PinModal
// must handle it, never auto-generate over it), 'none' (server CONFIRMED
// there's no backup at all — safe to auto-generate a keypair), or 'error'
// (the GET itself failed/network blip/non-ok — genuinely UNKNOWN state, must
// never be treated the same as a confirmed 'none').
// SP-1-04R: this 'error' distinction is the actual fix for a production
// bug — this function used to collapse "confirmed no backup" and "GET
// failed" into the same 'none', so a transient failure (e.g. hitting
// SP-1-01's backupFetchRateLimit) would make _doEnsureE2EKeys wrongly
// think a real encrypted-backup account had none, generate a bogus local
// keypair, and get permanently stuck (see HANDOVER for the full chain).
// SP-1-10: the legacy plain-backup auto-restore branch (no nonce/salt) was
// removed here — the last real straggler account was migrated to a
// PIN-encrypted backup and a production query confirms zero plain backups
// remain anywhere (users table or e2e_key_history). SP-1-01 already rejects
// any new plain backup on write, so this can no longer legitimately occur;
// if it somehow does, fail safe as 'error' rather than silently restoring
// plaintext key material into local storage.
// Wave 3A step 4 (found in the production proof): GET /users/me/e2e-keys is
// limited to 5 per 15 min per account (it doubles as the PIN-guess limiter),
// but one page load's BACKGROUND checks — ensureE2EKeys, PinModal's mount
// check, SecureChatsPrompt — used to fetch it separately, so a new-device
// sign-in plus a Chat PIN reset exhausted the budget and "Secure your chats"
// silently never appeared. Background checks now share one read for up to
// 30 s; any write to the backup clears it. Actual PIN/recovery restore
// attempts and PIN change still fetch fresh (they ARE what the limit counts).
let backupRead: { at: number; result: Promise<{ ok: boolean; data: any }> } | null = null
export function readServerBackup(accessToken: string): Promise<{ ok: boolean; data: any }> {
  if (backupRead && Date.now() - backupRead.at < 30_000) return backupRead.result
  const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
  const result = fetch(`${API}/users/me/e2e-keys`, { headers: { Authorization: `Bearer ${accessToken}` } })
    .then(async res => {
      const body = await res.json().catch(() => null)
      const out = { ok: res.ok && !!body?.ok, data: body?.data ?? null }
      if (!out.ok) backupRead = null // never cache a failure (429/5xx/network)
      return out
    })
    .catch(() => { backupRead = null; return { ok: false, data: null } })
  backupRead = { at: Date.now(), result }
  return result
}
export function forgetServerBackupRead(): void { backupRead = null }

async function tryRestoreFromServer(accessToken: string, _API: string): Promise<'protected' | 'none' | 'error'> {
  try {
    const data = await readServerBackup(accessToken)
    if (!data.ok) return 'error'
    if (data.data?.encrypted_private_key) {
      return data.data.nonce && data.data.salt ? 'protected' : 'error'
    }
    // SP-14-05: no backup by choice — restore is the user's key, never a new identity
    if (data.data?.backup_mode === 'max_privacy') return 'protected'
    return 'none' // real 2xx response, genuinely no backup on this account
  } catch { return 'error' }
}

async function _doEnsureE2EKeys(userId: string, accessToken: string): Promise<void> {
  // Already have keys on this device — nothing to do
  if (await unlockLocalKeys(userId)) return

  const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'

  const restoreStatus = await tryRestoreFromServer(accessToken, API)
  // 'error' must NEVER fall through to keypair generation below — an
  // account this device can't currently verify the state of is exactly
  // the case that must be left alone (retry on next app open instead).
  if (restoreStatus !== 'none') return

  // Server confirmed there's genuinely no backup at all — register a
  // fresh keypair's PUBLIC half only. SP-1-04R: never send a plain
  // (unencrypted) private-key backup here — SP-1-01 rejects it with a 400
  // that this code has no recovery path for, and even if it were accepted
  // it would defeat the whole encrypted-backup-only model. The device
  // still gets a real, usable local key immediately (Rule 6); an actual
  // encrypted backup gets attached the next time SecureChatsPrompt runs.
  const bundle = await initE2ENoPassphrase(userId)
  try {
    const res = await fetch(`${API}/users/me/e2e-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        identity_key: bundle.identity_key,
      })
    })
    // SP-0-05: server already had a different key registered (e.g. a transient
    // network error made an earlier restore attempt look like "no backup"). Our
    // freshly generated keypair is wrong — discard it and restore the real one
    // instead of leaving this device stuck with a keypair that can't read history.
    forgetServerBackupRead()
    if (res.status === 409) {
      clearE2EKeys(userId)
      await tryRestoreFromServer(accessToken, API)
    }
  } catch { /* best-effort — useChat will retry on next open */ }
}

function buildBundle(publicKey: Uint8Array): KeyBundle {
  return { identity_key: encodeBase64(publicKey) }
}

export async function restoreWithPassphrase(
  userId: string,
  passphrase: string,
  encryptedKeyB64: string,
  nonceB64: string,
  saltB64: string,
  accessToken?: string
): Promise<boolean> {
  try {
    const oprf: OprfContext | undefined = accessToken ? { accessToken } : undefined
    const key = await deriveKeyFromSaltField(passphrase, saltB64, oprf)
    const privateKey = nacl.secretbox.open(decodeBase64(encryptedKeyB64), decodeBase64(nonceB64), key)
    if (!privateKey) return false
    localStorage.setItem(`${KEYS_PREFIX}${userId}_salt`, saltB64)
    await storeLocalKey(userId, privateKey, { private_key_encrypted: encryptedKeyB64, private_key_nonce: nonceB64, has_passphrase: true })
    // SP-1-09: best-effort — also recover any previous key versions this
    // account rotated away from, so messages received before a past
    // rotation still decrypt. Never blocks/fails the main restore above;
    // only works for history entries protected by this SAME secret (a PIN
    // change between rotations means some entries just won't recover —
    // acceptable, matches the task's "where the data exists" framing).
    if (oprf) fetchAndCacheKeyHistory(userId, passphrase, oprf).catch(() => {})
    return true
  } catch (e) {
    // SP-14-02: an OPRF 429 is the guess limit, not a wrong PIN — rethrow so
    // the caller says "try later" instead of inviting another guess.
    if (e instanceof OprfError && e.status === 429) throw e
    return false
  }
}


function historyStorageKey(userId: string): string {
  return `${KEYS_PREFIX}${userId}_history`
}

// Returns cached historical private keys as raw bytes, newest first (most
// likely to matter for recent messages, tried first).
export function getHistoricalPrivateKeys(userId: string): Array<{ key_version: number; private_key: Uint8Array }> {
  return [...(memHistory.get(userId) ?? [])].sort((a, b) => b.key_version - a.key_version)
}

async function fetchAndCacheKeyHistory(userId: string, secret: string, oprf: OprfContext): Promise<void> {
  const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
  const res = await fetch(`${API}/users/me/e2e-keys/history`, {
    headers: { Authorization: `Bearer ${oprf.accessToken}` }
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok || !Array.isArray(data.data)) return

  const recovered: Array<{ key_version: number; public_key: string; private_key: Uint8Array }> = []
  for (const entry of data.data) {
    try {
      const key = await deriveKeyFromSaltField(secret, entry.salt, oprf)
      const privateKey = nacl.secretbox.open(decodeBase64(entry.encrypted_private_key), decodeBase64(entry.nonce), key)
      if (privateKey) {
        recovered.push({ key_version: entry.key_version, public_key: entry.public_key, private_key: privateKey })
      }
    } catch { /* this entry was protected by a different secret — skip it */ }
  }
  if (recovered.length > 0) await storeHistory(userId, recovered)
}

// ── SP-1-11: a CONTACT's public-key history (never our own) ─────
// SP-1-09 covers the reader's OWN past keys. Decrypting a message also
// needs the OTHER party's public key exactly as it was when that specific
// ciphertext was created — which may be an older version if they've since
// rotated (a gap SP-1-09 didn't touch). Public keys only, fetched from
// GET /users/:userId/e2e-key/history — never mixed into the TOFU pinning
// store (pinKey/getPinnedKey), which must keep tracking only the CURRENT
// key a substitution warning could fire against; this cache exists purely
// to make old ciphertext openable, not to influence what's trusted for
// sending new messages.
export interface ContactKey { key_version: number; public_key: string }

function contactKeysStorageKey(myUserId: string, contactId: string): string {
  return `${KEYS_PREFIX}${myUserId}_contact_keys_${contactId}`
}

export function getCachedContactKeys(myUserId: string, contactId: string): ContactKey[] {
  try {
    const raw = localStorage.getItem(contactKeysStorageKey(myUserId, contactId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function fetchAndCacheContactKeys(myUserId: string, contactId: string, accessToken: string): Promise<ContactKey[]> {
  const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
  try {
    const res = await fetch(`${API}/users/${contactId}/e2e-key/history`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const data = await res.json().catch(() => null)
    if (!data?.ok || !Array.isArray(data.data)) return getCachedContactKeys(myUserId, contactId)
    localStorage.setItem(contactKeysStorageKey(myUserId, contactId), JSON.stringify(data.data))
    return data.data
  } catch { return getCachedContactKeys(myUserId, contactId) }
}

// Pure, unit-testable version-selection logic. Orders a contact's known
// public keys to try for a given message: the version the message's own
// `key_version` column names is tried first (the fast, common case — this
// message's sender IS the contact, so that column names exactly the key
// version used), everything else follows newest-first. When targetVersion
// is undefined (the contact was the RECIPIENT, not the sender, of this
// message — i.e. we're re-reading our own sent message — the schema has no
// column recording the recipient's key_version at send time), every known
// version is still returned so the caller's cross-product retry can find
// the right one; there just isn't a single best-guess first pick.
export function selectContactKeyCandidates(keys: ContactKey[], targetVersion?: number): Uint8Array[] {
  const sorted = [...keys].sort((a, b) => {
    if (targetVersion !== undefined) {
      if (a.key_version === targetVersion) return -1
      if (b.key_version === targetVersion) return 1
    }
    return b.key_version - a.key_version
  })
  return sorted.map(k => decodeBase64(k.public_key))
}

// SP-1-12: the decrypt fallback-ordering logic useChat.ts's tryDecrypt uses
// once the fast (current-key) path fails — tries every combination of a
// contact's known public keys (pre-ordered by selectContactKeyCandidates)
// against every one of the reader's own known private keys, contact-key
// outermost so the most-likely-correct contact version is exhausted
// against all of the reader's own key versions before moving to a less
// likely one. `decryptFn` is injected so this ordering can be unit-tested
// without real crypto or a rendered hook (this codebase has no
// component/hook test harness — see e2e.test.ts).
export function tryDecryptWithCandidates<T>(
  decryptFn: (otherPubKey: Uint8Array, myPrivKey: Uint8Array) => T | null,
  otherPubKeyCandidates: Uint8Array[],
  myPrivKeyCandidates: Uint8Array[],
): T | null {
  for (const otherKey of otherPubKeyCandidates) {
    for (const myKey of myPrivKeyCandidates) {
      const result = decryptFn(otherKey, myKey)
      if (result !== null) return result
    }
  }
  return null
}

// SP-1-02: signup-time Chat PIN flow. Generates a brand-new keypair and
// uploads an ALREADY-ENCRYPTED backup (nonce+salt+kdf all present, satisfying
// SP-1-01's requirement) — there is no unencrypted-backup step at any point,
// unlike the older no-passphrase path this coexists with for now.
export async function initE2EWithPin(
  userId: string,
  pin: string,
  accessToken: string
): Promise<boolean> {
  try {
    const keypair = nacl.box.keyPair()
    const { saltField: saltB64, key } = await newV3Key(pin, { accessToken })
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(keypair.secretKey, nonce, key)

    const encryptedB64 = encodeBase64(encrypted)
    const nonceB64 = encodeBase64(nonce)
    const publicKeyB64 = encodeBase64(keypair.publicKey)

    const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
    const body = JSON.stringify({
      identity_key: publicKeyB64,
      encrypted_private_key: encryptedB64,
      e2e_nonce: nonceB64,
      e2e_salt: saltB64,
      kdf: KDF_V3_TAG,
    })

    // SP-1-06: key registration is a blocking step of signup — retry transient
    // failures (flaky mobile network, brief 5xx) a few times with backoff
    // before giving up, so signup doesn't fail on a one-off blip.
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)))
      try {
        const res = await fetch(`${API}/users/me/e2e-keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body
        })
        const data = await res.json().catch(() => null)
        ok = res.ok && data?.ok !== false
        forgetServerBackupRead()
      } catch { /* network error — retry */ }
    }
    if (!ok) return false

    localStorage.setItem(`${KEYS_PREFIX}${userId}_salt`, saltB64)
    await storeLocalKey(userId, keypair.secretKey, { private_key_encrypted: encryptedB64, private_key_nonce: nonceB64, has_passphrase: true })
    return true
  } catch {
    return false
  }
}

export type ProtectBackupResult = 'ok' | 'conflict' | 'error'

// SP-1-04R: returns WHY a failure happened, not just true/false — a caller
// needs to tell "network blip, just retry" apart from "409 conflict" (the
// server already has a DIFFERENT key than what this device thinks is
// current — a strong signal the local key is stale, not a reason to keep
// retrying the same doomed request).
export async function protectChatKeyBackup(
  userId: string,
  passphrase: string,
  accessToken: string,
  migration = false
): Promise<ProtectBackupResult> {
  try {
    await unlockLocalKeys(userId)
    const stored = getStored(userId)
    const privateKey = getPrivateKey(userId)
    if (!stored?.public_key || !privateKey) return 'error'

    const { saltField: saltB64, key } = await newV3Key(passphrase, { accessToken })
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(privateKey, nonce, key)

    const encryptedB64 = encodeBase64(encrypted)
    const nonceB64 = encodeBase64(nonce)

    const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
    const res = await fetch(`${API}/users/me/e2e-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        identity_key: stored.public_key,
        encrypted_private_key: encryptedB64,
        e2e_nonce: nonceB64,
        e2e_salt: saltB64,
        kdf: KDF_V3_TAG,
        migration,
      })
    })
    forgetServerBackupRead()
    if (res.status === 409) return 'conflict'
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.ok === false) return 'error'

    localStorage.setItem(`${KEYS_PREFIX}${userId}_salt`, saltB64)
    localStorage.setItem(`${KEYS_PREFIX}${userId}`, JSON.stringify({
      ...stored,
      private_key_encrypted: encryptedB64,
      private_key_nonce: nonceB64,
      has_passphrase: true,
    }))
    return 'ok'
  } catch {
    return 'error'
  }
}

// ── SP-1-05: Recovery key + Change PIN ─────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function decodeBase32(str: string): Uint8Array {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0, value = 0
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}

// A recovery key is already high-entropy random data (not a human passphrase),
// so it's used directly as key material via a hash — no PBKDF2 stretching
// needed (that's for slow-brute-forcing low-entropy secrets, not this).
async function deriveKeyFromRecoveryKey(recoveryKey: string): Promise<Uint8Array> {
  const bytes = decodeBase32(recoveryKey)
  return nacl.hash(bytes).slice(0, 32)
}

// Generates a new 64-char base32 recovery key, encrypts the current device's
// private key with it, and uploads it alongside (not replacing) the main
// PIN-encrypted backup. Returns the plaintext recovery key to show ONCE —
// nothing but its ciphertext is ever persisted anywhere.
export async function generateRecoveryKey(userId: string, accessToken: string): Promise<string | null> {
  try {
    await unlockLocalKeys(userId)
    const stored = getStored(userId)
    const sk = getPrivateKey(userId)
    if (!stored?.public_key || !sk) return null

    const recoveryKeyBytes = nacl.randomBytes(40) // 40 bytes -> exactly 64 base32 chars
    const recoveryKey = encodeBase32(recoveryKeyBytes)
    const key = await deriveKeyFromRecoveryKey(recoveryKey)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(sk, nonce, key)

    const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
    const res = await fetch(`${API}/users/me/e2e-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        // Re-send the existing main backup unchanged — POST /me/e2e-keys does
        // a blanket UPDATE, so omitting these would wipe the PIN backup.
        identity_key: stored.public_key,
        encrypted_private_key: stored.private_key_encrypted || null,
        e2e_nonce: stored.private_key_nonce || null,
        e2e_salt: localStorage.getItem(`${KEYS_PREFIX}${userId}_salt`) || null,
        kdf: stored.private_key_encrypted ? kdfLabelOf(localStorage.getItem(`${KEYS_PREFIX}${userId}_salt`) || '') : undefined,
        recovery_encrypted: encodeBase64(encrypted),
        recovery_nonce: encodeBase64(nonce),
      })
    })
    forgetServerBackupRead()
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.ok === false) return null
    return recoveryKey
  } catch {
    return null
  }
}

// Restores a device's keys using a recovery key instead of the Chat PIN.
export async function restoreWithRecoveryKey(
  userId: string,
  recoveryKey: string,
  recoveryEncryptedB64: string,
  recoveryNonceB64: string,
  publicKey: string
): Promise<boolean> {
  try {
    const key = await deriveKeyFromRecoveryKey(recoveryKey)
    const privateKey = nacl.secretbox.open(decodeBase64(recoveryEncryptedB64), decodeBase64(recoveryNonceB64), key)
    if (!privateKey) return false
    // Wave 3A step 4: the recovered key must be the account's CURRENT key
    // (a recovery blob left over from before a key change would otherwise
    // install a key that can't read anything new, silently).
    if (encodeBase64(nacl.box.keyPair.fromSecretKey(privateKey).publicKey) !== publicKey) return false
    await storeLocalKey(userId, privateKey, { private_key_encrypted: '', private_key_nonce: '', has_passphrase: true })
    return true
  } catch {
    return false
  }
}

// ── SP-14-05: Maximum privacy (no server backup) ───────────────
// The key the user keeps IS the private key: 32 key bytes + an 8-byte
// domain-separated checksum (typo detection), base32 → the same 64-character
// format as a recovery key. Nothing about it is stored anywhere but here.
const MAX_PRIVACY_DOMAIN = new TextEncoder().encode('spandik-max-privacy-v1')
const maxPrivacyChecksum = (sk: Uint8Array) => nacl.hash(new Uint8Array([...MAX_PRIVACY_DOMAIN, ...sk])).slice(0, 8)

export function maxPrivacyKey(userId: string): string | null {
  const sk = getPrivateKey(userId)
  return sk ? encodeBase32(new Uint8Array([...sk, ...maxPrivacyChecksum(sk)])) : null
}

// Restores from a maximum-privacy key alone. It must decode to exactly this
// account's CURRENT public key (a typo or another account's key never installs).
export async function restoreWithMaxPrivacyKey(userId: string, key: string, publicKey: string): Promise<boolean> {
  const bytes = decodeBase32(key)
  if (bytes.length !== 40) return false
  const sk = bytes.slice(0, 32)
  if (encodeBase64(bytes.slice(32)) !== encodeBase64(maxPrivacyChecksum(sk))) return false
  const pk = encodeBase64(nacl.box.keyPair.fromSecretKey(sk).publicKey)
  if (pk !== publicKey) return false
  await storeLocalKey(userId, sk, { private_key_encrypted: '', private_key_nonce: '', has_passphrase: true })
  return true
}

// Server switch (the caller gets the fresh re-auth grant first). Turning it
// OFF marks this device "unprotected" so SecureChatsPrompt asks for a new
// Chat PIN — the server has no backup until one is set.
export async function setMaxPrivacy(userId: string, enable: boolean, accessToken: string): Promise<boolean> {
  const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
  try {
    const res = await fetch(`${API}/users/me/e2e-keys/max-privacy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ enable }),
    })
    forgetServerBackupRead()
    if (!res.ok) return false
    const stored = getStored(userId)
    if (stored) {
      localStorage.setItem(`${KEYS_PREFIX}${userId}`, JSON.stringify({ ...stored, has_passphrase: enable, private_key_encrypted: '', private_key_nonce: '' }))
      localStorage.removeItem(`${KEYS_PREFIX}${userId}_salt`)
    }
    return true
  } catch { return false }
}

// Changes the Chat PIN: verifies the OLD PIN actually opens the currently
// stored backup (proving the caller knows it, mirroring how "change
// password" requires the current password) before re-encrypting with the
// new one via the existing protectChatKeyBackup path.
// Wave 3A step 4: checked against the SERVER's current backup, not this
// device's local copy — another device may have changed the PIN since this
// one restored (a stale local copy would accept the old PIN), and a device
// restored with the recovery key has no local copy at all. The backup must
// also hold this device's own key, so a PIN change can never re-wrap a
// different key.
export async function changeChatPin(
  userId: string,
  oldPin: string,
  newPin: string,
  accessToken: string
): Promise<boolean> {
  await unlockLocalKeys(userId)
  const local = getPrivateKey(userId)
  if (!local) return false
  try {
    const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
    const res = await fetch(`${API}/users/me/e2e-keys`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data = await res.json().catch(() => null)
    const b = data?.data
    if (!res.ok || !b?.encrypted_private_key || !b.nonce || !b.salt) return false
    const opened = nacl.secretbox.open(decodeBase64(b.encrypted_private_key), decodeBase64(b.nonce), await deriveKeyFromSaltField(oldPin, b.salt, { accessToken }))
    if (!opened || encodeBase64(opened) !== encodeBase64(local)) return false
  } catch (e) {
    if (e instanceof OprfError && e.status === 429) throw e
    return false
  }
  return (await protectChatKeyBackup(userId, newPin, accessToken)) === 'ok'
}

// SP-14-02 migration: re-wrap the server backup as KDF v3 under the current
// OPRF version, keeping the same PIN and key. The same server-verified path
// as a PIN change (old secret must open the CURRENT server backup and hold
// this device's key), so it can never re-wrap a stale or foreign key. The
// caller obtains the fresh re-auth grant first (replacing a backup needs it).
export function upgradeChatBackup(userId: string, secret: string, accessToken: string): Promise<boolean> {
  return changeChatPin(userId, secret, secret, accessToken)
}

// SP-1-13: "forgot my PIN and have no recovery key" — deletes the server-side
// key/backup entirely (requires a fresh re-auth grant, see POST /auth/reauth)
// and clears whatever this device has cached. History encrypted under the
// old key becomes permanently unrecoverable — that is the documented,
// honest behavior, not a bug. The caller is responsible for confirming the
// user understands this before calling.
export async function resetE2EKeys(userId: string, accessToken: string): Promise<boolean> {
  try {
    const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com'
    const res = await fetch(`${API}/users/me/e2e-keys/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    forgetServerBackupRead()
    if (!res.ok) return false
    clearE2EKeys(userId)
    return true
  } catch {
    return false
  }
}
