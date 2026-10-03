// SP-14-01 operator tool (kdf-check.html): times the exact Argon2id step of
// KDF v3 (utils/pinOprf.ts) on a real device. Public, no auth, no network.
import { argon2id } from 'hash-wasm'
import { ARGON2 } from './utils/pinOprf'

const out = document.getElementById('out')!
document.getElementById('run')!.addEventListener('click', async () => {
  out.textContent = `${navigator.userAgent}\ncores: ${navigator.hardwareConcurrency ?? '?'}  memory: ${(navigator as any).deviceMemory ?? '?'} GB\n\n`
  const ms: number[] = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await argon2id({ password: crypto.getRandomValues(new Uint8Array(64)), salt: crypto.getRandomValues(new Uint8Array(16)), ...ARGON2, outputType: 'binary' })
    ms.push(Math.round(performance.now() - t0))
    out.textContent += `run ${i + 1}: ${ms[i]} ms\n`
  }
  out.textContent += `\nmedian: ${[...ms].sort((a, b) => a - b)[2]} ms  (target 500–1000 ms on a low-end Android)`
})
