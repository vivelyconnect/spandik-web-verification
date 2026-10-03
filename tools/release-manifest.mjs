#!/usr/bin/env node
// scripts/release-manifest.mjs — SP-14-04 release transparency (client side).
// A manifest = every shipped file's SHA-256 + one root hash over them, for a
// given commit. Anyone can rebuild that commit (frontend: `npm ci`, then the
// Pages build env, `npx vite build`) and get byte-identical files — proven
// 2026-10-03: 67/67 files of production deploy 6255ec0 matched a local rebuild.
//
//   node scripts/release-manifest.mjs <dist-dir> [commit]          → manifest JSON
//   node scripts/release-manifest.mjs --compare <dist-dir> <base-url>
//        → fetches every file of <dist-dir> from the live site; exit 1 on any difference
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const sha = buf => createHash('sha256').update(buf).digest('hex')
function files(dir, base = dir) {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p, base) : [path.relative(base, p).split(path.sep).join('/')]
  }).filter(f => /\.(html|js|css|json|webmanifest|svg|png|webp|woff2?)$/.test(f)).sort()
}
// Pages serves /x.html at /x and /index.html at / (clean URLs).
const urlPath = f => '/' + f.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')

const [a, b, c] = process.argv.slice(2)
if (a === '--compare') {
  let bad = 0
  for (const f of files(b)) {
    const live = Buffer.from(await (await fetch(new URL(urlPath(f), c))).arrayBuffer())
    if (sha(live) !== sha(readFileSync(path.join(b, f)))) { bad++; console.log(`DIFFERS  ${f}`) }
  }
  console.log(bad ? `${bad} file(s) differ` : 'all files identical')
  process.exit(bad ? 1 : 0)
} else if (a) {
  const entries = files(a).map(f => [f, sha(readFileSync(path.join(a, f)))])
  const root = sha(entries.map(([f, h]) => `${h}  ${f}\n`).join(''))
  console.log(JSON.stringify({ commit: b || null, root, files: Object.fromEntries(entries) }, null, 1))
} else {
  console.error('usage: release-manifest.mjs <dist-dir> [commit] | --compare <dist-dir> <base-url>'); process.exit(2)
}
