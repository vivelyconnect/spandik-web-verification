// src/utils/pinOprf.ts — SP-14-01/02: client half of KDF v3 for the Chat-PIN
// backup. key = Argon2id(OPRF(PIN), salt): the PIN is blinded before it leaves
// the device (RFC 9497 base mode, ristretto255-SHA512, voprf-ts — the server
// never sees the PIN or the output), and the unblinded 64-byte output is
// stretched with Argon2id (hash-wasm) as defence in depth for the case where
// the server's OPRF seed AND the database both leak. Mirrors api/src/services/
// pinOprf.ts. Both libraries load lazily — only PIN flows pay for them.
const OPRF_TAG = 'v3.oprf-ristretto255.argon2id-m19456-t2-p1'
export const ARGON2 = { memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 } as const

export const KDF_V3_TAG = OPRF_TAG

export class OprfError extends Error {
  constructor(public status: number, message: string, public retryAfterSec?: number) { super(message) }
}

// Whole minutes until a rate-limited request may be retried (Retry-After, in
// seconds, from an OprfError or an axios error), or null when unknown.
export function retryAfterMinutes(err: any): number | null {
  const sec = Number(err?.retryAfterSec ?? err?.response?.headers?.['retry-after'])
  return sec > 0 ? Math.ceil(sec / 60) : null
}

// One restore can need several derivations with the same PIN (current
// backup + key-history entries); each OPRF call is one counted guess on the
// server, so a context reuses the output per (PIN, version) for one operation.
export interface OprfContext {
  accessToken: string
  outputs?: Map<string, Promise<{ version: number; out: Uint8Array }>>
}

const apiBase = () => ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'https://api.spandik.com')
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0))

async function evaluate(pin: string, version: number | undefined, accessToken: string): Promise<{ version: number; out: Uint8Array }> {
  const [{ Oprf, OPRFClient, Evaluation }, { CryptoNoble }] = await Promise.all([
    import('@cloudflare/voprf-ts'), import('@cloudflare/voprf-ts/crypto-noble'),
  ])
  const suite = Oprf.Suite.RISTRETTO255_SHA512
  const client = new OPRFClient(suite, CryptoNoble)
  const [finalization, request] = await client.blind([new TextEncoder().encode(pin)])
  const res = await fetch(`${apiBase()}/users/me/e2e-keys/oprf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ blinded: b64(request.serialize()), ...(version ? { version } : {}) }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.data?.evaluated) throw new OprfError(res.status, data?.error || 'OPRF evaluation failed', Number(res.headers.get('Retry-After')) || undefined)
  const [out] = await client.finalize(finalization, Evaluation.deserialize(suite, unb64(data.data.evaluated), CryptoNoble))
  return { version: data.data.version, out }
}

function oprfOutput(pin: string, version: number | undefined, ctx: OprfContext) {
  const key = `${version ?? 'current'}`
  ctx.outputs ??= new Map()
  // ponytail: keyed by version only — one context is one operation with one PIN
  let p = ctx.outputs.get(key)
  if (!p) { p = evaluate(pin, version, ctx.accessToken); ctx.outputs.set(key, p); p.catch(() => ctx.outputs!.delete(key)) }
  return p
}

async function stretch(out: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm')
  return argon2id({ password: out, salt, ...ARGON2, outputType: 'binary' })
}

// A fresh v3 salt field + its key, under the server's CURRENT OPRF version.
export async function newV3Key(pin: string, ctx: OprfContext): Promise<{ saltField: string; key: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const { version, out } = await oprfOutput(pin, undefined, ctx)
  return { saltField: `${OPRF_TAG}:${version}:${b64(salt)}`, key: await stretch(out, salt) }
}

// The key for an existing v3 salt field (the version it names). Throws on a
// malformed field — callers treat that as "cannot open", never as a downgrade.
export async function v3Key(pin: string, rest: string, ctx: OprfContext): Promise<Uint8Array> {
  const m = rest.match(/^(\d+):([A-Za-z0-9+/=]+)$/)
  if (!m) throw new Error('Malformed v3 salt')
  const { out } = await oprfOutput(pin, Number(m[1]), ctx)
  return stretch(out, unb64(m[2]))
}

// The OPRF version a v3 salt field uses; null for any other format.
export function v3VersionOf(saltField: string | null | undefined): number | null {
  const m = saltField?.match(/^([^:]+):(\d+):/)
  return m && m[1] === OPRF_TAG ? Number(m[2]) : null
}
