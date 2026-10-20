#!/usr/bin/env bash
# Live proof of two default-off ruflo-mods options that only had kit tests: capabilityProbe (ADR-451 item 5) and sessionRollup
# (item 6), each against a REAL headless Claude Code session with the plugin loaded by --plugin-dir. Method follows
# scripts/live-ruflo-mods.sh (option enabling, user-global $.store snapshot/restore) and live-ruflo-mods-paths.sh (scratch projects).
#   scripts/live-ruflo-mods-options.sh [probe rollup | all]   (default: all)
# Private mktemp scratch projects; haiku only (about $1 for `all`). Env: LIVE_MODEL.
# Output is screened: a line that looks like auth/account/telemetry content is dropped and counted, never printed or stored.
# The secret-shaped canary is built at runtime from fragments, so it never appears in this file.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="${LIVE_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/mods-options.XXXXXX")}"
PHASES=("$@"); [ ${#PHASES[@]} -eq 0 ] && PHASES=(all)
[ "${PHASES[0]}" = all ] && PHASES=(probe rollup)
mkdir -p "$S"
echo "scratch: $S"
sed -n '/^# --- node driver ---$/,$p' "$0" | sed 1d >"$S/live.mjs"
for p in "${PHASES[@]}"; do echo "== phase: $p"; node "$S/live.mjs" "$p" "$S" "$REPO" || echo "phase $p exited $?"; done
echo "results: $S"
exit 0
# --- node driver ---
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [phase, S, REPO] = process.argv.slice(2)
const PLUG = `${REPO}/plugins/ruflo-mods`
const MODEL = process.env.LIVE_MODEL ?? 'haiku'
const AUTHLIKE = /bearer\s|authorization|api[_-]?key|sk-ant|oauth|access[_-]?token|refresh[_-]?token|account[_ -]?(id|uuid)|organization|telemetry|[\w.+-]+@[\w-]+\.[a-z]{2,}/i
let withheld = 0
const clean = text => String(text ?? '').split('\n').map(l => (AUTHLIKE.test(l) ? (withheld++, '[withheld: auth-like line]') : l)).join('\n')
// A secret-shaped token assembled at runtime; the prefix and body are separate literals.
const CANARY = ['sk', 'live', 'Zq9'].join('-') + ['Xw3Lm', 'Pd7Ra', 'Tn5Vb', 'Hc2Jk'].join('')

function project(name) {
  const dir = join(S, name)
  mkdirSync(join(dir, '.claude-flow'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}
const settingsFile = options => {
  const f = join(S, `settings-${Math.random().toString(36).slice(2, 8)}.json`)
  const o = options ? { options } : undefined
  writeFileSync(f, JSON.stringify(o ? { pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } } : {}))
  return f
}
async function session(dir, prompts, { options, tools = [], budget = '0.30' } = {}) {
  const denied = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', ...(tools.includes('Bash') ? [] : ['Bash'])]
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--plugin-dir', PLUG,
    '--settings', settingsFile(options), '--setting-sources', 'local', '--max-budget-usd', budget,
    '--allowedTools', tools.join(',') || 'ToolSearch', '--disallowedTools', denied.join(','), '--append-system-prompt', 'Answer exactly as asked, no commentary.']
  const p = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } })
  let buf = '', onResult
  p.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      try { const m = JSON.parse(line); if (m.type === 'result' && onResult) onResult(m) } catch {}
    }
  })
  const rows = []
  for (const text of prompts) {
    const done = new Promise(res => { onResult = res })
    p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    const r = await Promise.race([done, new Promise(res => setTimeout(() => res(undefined), 120_000))])
    rows.push({ prompt: text, reply: r?.result ?? '(timeout)', cost: r?.total_cost_usd })
  }
  p.stdin.end()
  await new Promise(res => { const t = setTimeout(() => (p.kill(), res()), 15_000); p.on('close', () => (clearTimeout(t), res())) })
  return { rows, cost: rows.at(-1)?.cost }
}
const show = (name, res, shown = res.rows.map(() => true)) => {
  res.rows.forEach((r, i) => { if (shown[i]) console.log(`[${name}] > ${r.prompt.replace(CANARY, '<canary>').slice(0, 110)}\n${clean(r.reply)}`) })
  console.log(`[${name}] cost $${res.cost}\n`)
}
const statusLines = (reply, re) => String(reply).split('\n').filter(l => re.test(l)).map(l => l.trim()).join('\n') || '(no matching line)'
const RAN = 'Run this exact shell command with the Bash tool and then reply with only the word RAN: echo hello > ran.txt'

// The ledger is the user-global $.store of the inline plugin; snapshot every ruflo-mods store file (and the set of them) and restore after.
const STORE_DIR = join(process.env.HOME ?? '', '.claude/plugins/store')
const storeNames = () => (existsSync(STORE_DIR) ? readdirSync(STORE_DIR).filter(n => /^ruflo-mods_inline-.*\.json$/.test(n)) : [])
const storeText = () => storeNames().map(n => readFileSync(join(STORE_DIR, n), 'utf8')).join('\n')
async function withStoreRestored(run) {
  const saved = new Map(storeNames().map(n => [n, readFileSync(join(STORE_DIR, n))]))
  try { return await run() } finally {
    for (const n of storeNames()) if (!saved.has(n)) rmSync(join(STORE_DIR, n))
    for (const [n, b] of saved) writeFileSync(join(STORE_DIR, n), b)
  }
}
const records = () => storeNames().flatMap(n => { try { const v = JSON.parse(readFileSync(join(STORE_DIR, n), 'utf8')).sessionRollup; return Array.isArray(v) ? v : [] } catch { return [] } })

const heartbeat = dir => { const f = join(dir, '.claude-flow/mods/session.json'); return existsSync(f) ? clean(readFileSync(f, 'utf8').replace(/\s+/g, ' ')) : 'absent' }

async function probe() {
  const off = project('probe-off')
  const a = await session(off, ['/ruflo-mods'])
  show('probe-off', a)
  console.log(`[probe-off] probe line: ${statusLines(a.rows[0].reply, /probe/)}\n[probe-off] session.json: ${heartbeat(off)}\n`)

  const on = project('probe-on')
  const b = await session(on, ['/ruflo-mods', RAN, 'Reply with only the word pong.', '/ruflo-mods'], { options: { capabilityProbe: true }, tools: ['Bash'], budget: '0.40' })
  show('probe-on', b, [true, false, false, false])
  console.log(`[probe-on] ran.txt: ${existsSync(join(on, 'ran.txt')) ? 'exists' : 'absent'}`)
  console.log(`[probe-on] probe line before any prompt: ${statusLines(b.rows[0].reply, /probe/)}`)
  console.log(`[probe-on] probe line after a prompt and a tool call: ${statusLines(b.rows[3].reply, /probe/)}`)
  console.log(`[probe-on] session.json: ${heartbeat(on)}\n`)
}

async function rollup() {
  await withStoreRestored(async () => {
    const SESSIONS = /sessions:|kept; last|newest:/
    const n0 = records().length
    console.log(`[rollup] records in the user-global store before: ${n0}`)

    const off = await session(project('rollup-off'), ['/ruflo-mods', RAN, `Reply with only the word pong. (token: ${CANARY})`, '/ruflo-mods'], { tools: ['Bash'], budget: '0.40' })
    console.log(`[rollup-off] report: ${statusLines(off.rows[3].reply, SESSIONS)}\n[rollup-off] records after the session: ${records().length} (before ${n0}); store mentions the canary: ${storeText().includes(CANARY)}\n`)

    const o1 = { sessionRollup: true }
    const s1 = await session(project('rollup-on-1'), ['/ruflo-mods', RAN, `Reply with only the word pong. (token: ${CANARY})`, '/ruflo-mods'], { options: o1, tools: ['Bash'], budget: '0.40' })
    const r1 = records()
    console.log(`[rollup-on-1] report mid-session: ${statusLines(s1.rows[3].reply, SESSIONS)}`)
    console.log(`[rollup-on-1] records after the session: ${r1.length} (before ${n0}); newest: ${JSON.stringify(r1.at(-1))}`)

    const o2 = { sessionRollup: true, capabilityProbe: true }
    const s2 = await session(project('rollup-on-2'), ['/ruflo-mods'], { options: o2 })
    const r2 = records()
    console.log(`[rollup-on-2] report at start: ${statusLines(s2.rows[0].reply, SESSIONS)}`)
    console.log(`[rollup-on-2] records after the session: ${r2.length}; newest: ${JSON.stringify(r2.at(-1))}`)

    const ALLOWED = new Set(['at', 'tools', 'routed', 'tightened', 'denied', 'spawns', 'cost', 'probe'])
    const keys = new Set(r2.slice(n0).flatMap(r => Object.keys(r)))
    console.log(`[rollup] keys across the new records: ${[...keys].sort().join(',')}; all whitelisted: ${[...keys].every(k => ALLOWED.has(k))}`)
    const replies = [off, s1, s2].flatMap(s => s.rows.map(r => r.reply)).join('\n')
    console.log(`[rollup] canary in any store file: ${storeText().includes(CANARY)}; in any /ruflo-mods report: ${[s1.rows[0].reply, s1.rows[3].reply, s2.rows[0].reply, off.rows[3].reply].some(t => t.includes(CANARY))}; canary echoed in any model reply (informational): ${replies.includes(CANARY)}`)
    console.log(`[rollup] cost $${(off.cost ?? 0) + (s1.cost ?? 0) + (s2.cost ?? 0)}`)
  })
  console.log('[rollup] store files restored to their pre-run state\n')
}
const PHASE = { probe, rollup }
if (!PHASE[phase]) { console.error(`unknown phase ${phase}`); process.exit(2) }
await PHASE[phase]()
console.log(`lines withheld as auth-like: ${withheld}`)
process.exit(0)
