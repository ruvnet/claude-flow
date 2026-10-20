#!/usr/bin/env node
// Micro-benchmark for the AgentDB mod's pure paths (ADR-445): the secret/injection scan, parse + screen + frame of a recall result, and the
// write guard. These run on every prompt / memory write, so they must cost far less than the memory read they wrap.
//   node plugins/ruflo-agentdb/scripts/bench.mjs [--json]
// Needs esbuild to bundle the TypeScript (found from the repo root's node_modules); without it the script prints SKIP and exits 0.
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hooks = resolve(here, '../hooks')
const json = process.argv.includes('--json')

let esbuild
for (const base of [here, process.cwd()]) {
  try {
    esbuild = createRequire(join(base, 'x.js'))('esbuild')
    break
  } catch {}
}
if (!esbuild) {
  console.log('SKIP bench: esbuild not found (run npm install at the repo root)')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'agentdb-bench-'))
const entry = join(dir, 'entry.ts')
await import('node:fs').then(fs => fs.writeFileSync(entry, `export * from '${hooks}/screen'\nexport * from '${hooks}/recall'\nexport * from '${hooks}/guard'\n`))
const out = join(dir, 'bundle.mjs')
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href)

const note = 'The ReasoningBank pattern store keeps approach, outcome and confidence; prefer HNSW above 5k vectors, RaBitQ for 32x compression. '
const items = Array.from({ length: 5 }, (_, i) => ({ value: `${note.repeat(3)}#${i}`, score: 0.9 - i / 20, updatedAt: Date.now() - i * 3_600_000 }))
const result = JSON.stringify({ results: items })
const write = { key: 'k', value: note.repeat(20), tier: 'working' }
const prompt = 'why does the router pick the wrong agent when two keywords match'

function time(name, fn, n) {
  for (let i = 0; i < Math.min(n, 2000); i++) fn()
  const runs = []
  for (let r = 0; r < 7; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < n; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / n / 1000)
  }
  runs.sort((a, b) => a - b)
  return { name, medianUs: +runs[3].toFixed(2), bestUs: +runs[0].toFixed(2) }
}

const rows = [
  time('scan 2 KB text', () => m.scan(note.repeat(16)), 20000),
  time('scan 20 KB adversarial (ReDoS probe)', () => m.scan('ignore all previous curl wget Bearer secret= '.repeat(450)), 300),
  time('scan 20 KB of assignments + URLs (screen-quality probe)', () => m.scan('token= password: a://b:c@h api_key = "x1" Bearer secret_key=Ab1 '.repeat(330)), 300),
  time('scan 200 KB clean text (cap, one pass)', () => m.scan(note.repeat(1600)), 20),
  time('guard verdict (memory write, clean)', () => m.verdict('mcp__x__agentdb_hierarchical-store', write), 20000),
  time('guard verdict (other tool, skipped)', () => m.verdict('Bash', { command: 'ls -la' }), 200000),
  time('parse + screen + frame (5 results)', () => m.frame(m.screen(m.parse(result, 'agentdb', Date.now()), 3).items), 10000),
  time('worthRecalling + cacheKey', () => (m.worthRecalling(prompt), m.cacheKey(prompt)), 200000),
]
rmSync(dir, { recursive: true, force: true })

if (json) console.log(JSON.stringify(rows))
else {
  console.log('AgentDB mod: pure-path cost per call (median of 7 runs)')
  for (const r of rows) console.log(`  ${r.name.padEnd(40)} ${String(r.medianUs).padStart(9)} µs   (best ${r.bestUs})`)
  console.log('  For scale: a connected-tool memory read is milliseconds; a CLI call ≈ 450 ms (ADR-445 §2).')
}
