// src/utils/safetyNumber.ts — SP-14-03: contact verification for first-contact
// TOFU. Same construction as Signal's numeric fingerprint (version 0): per
// party, H0 = SHA-512(0x0000 || identityKey || userId), then 5199 rounds of
// H = SHA-512(H || identityKey); the first 30 bytes become six 5-digit groups
// (each 5-byte big-endian chunk mod 100000). The two 30-digit halves are
// ordered by user id, so both people see the same 60 digits. Comparing them
// (in person, on a call, or by scanning the other's QR) proves neither side is
// talking to a key the server substituted.
import nacl from 'tweetnacl'
import { decodeBase64 } from 'tweetnacl-util'

const ITERATIONS = 5200
const QR_PREFIX = 'SPANDIK-SN:0:'

function half(userId: string, identityKey: Uint8Array): string {
  const id = new TextEncoder().encode(userId)
  let h = nacl.hash(new Uint8Array([0, 0, ...identityKey, ...id]))
  for (let i = 1; i < ITERATIONS; i++) h = nacl.hash(new Uint8Array([...h, ...identityKey]))
  let out = ''
  for (let c = 0; c < 6; c++) {
    let n = 0
    for (let b = 0; b < 5; b++) n = n * 256 + h[c * 5 + b]
    out += String(n % 100000).padStart(5, '0')
  }
  return out
}

// 60 digits, identical on both sides. Keys are base64 (as stored/pinned).
export function safetyNumber(userA: string, keyA: string, userB: string, keyB: string): string {
  const a = half(userA, decodeBase64(keyA)), b = half(userB, decodeBase64(keyB))
  return userA < userB ? a + b : b + a
}

export const groupsOf5 = (digits: string) => digits.match(/\d{5}/g) ?? []
export const qrPayload = (digits: string) => QR_PREFIX + digits
export const digitsFromQr = (text: string) => (text.startsWith(QR_PREFIX) && /^\d{60}$/.test(text.slice(QR_PREFIX.length)) ? text.slice(QR_PREFIX.length) : null)

// Verified state is per device and bound to the exact key that was verified:
// any key change (new phone, reset, or substitution) makes it false at once.
const storeKey = (me: string, contact: string) => `spandik_e2e_${me}_verified_${contact}`
export function markVerified(me: string, contact: string, contactKey: string): void { localStorage.setItem(storeKey(me, contact), contactKey) }
export function clearVerified(me: string, contact: string): void { localStorage.removeItem(storeKey(me, contact)) }
export function isVerified(me: string, contact: string, contactKey: string | null): boolean {
  return !!contactKey && localStorage.getItem(storeKey(me, contact)) === contactKey
}
