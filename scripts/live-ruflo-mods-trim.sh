#!/usr/bin/env bash
# Measures ruflo-mods agentTrim (ADR-451 item 2) against REAL headless Claude Code sessions with many ruflo agent plugins loaded.
#   scripts/live-ruflo-mods-trim.sh [tokens enum spawn named | all]   (default: all)
# Method follows scripts/live-ruflo-mods.sh: private mktemp scratch project, one headless process per case, stream-json.
# Spend: haiku only (about $1.5 for `all`). Env: LIVE_MODEL, LIVE_REPS (token-phase repetitions per arm, default 2).
# Writes $S/*.json. Prints only model replies and counts; lines that look auth/account/telemetry-like are dropped.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="${LIVE_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/mods-trim.XXXXXX")}"
PHASES=("$@"); [ ${#PHASES[@]} -eq 0 ] && PHASES=(all)
[ "${PHASES[0]}" = all ] && PHASES=(tokens enum spawn named)
mkdir -p "$S"; [ -d "$S/.git" ] || (cd "$S" && git init -q)
echo "scratch: $S"
sed -n '/^# --- node driver ---$/,$p' "$0" | sed 1d >"$S/live.mjs"
for p in "${PHASES[@]}"; do echo "== phase: $p"; node "$S/live.mjs" "$p" "$S" "$REPO" || echo "phase $p exited $?"; done
echo "results: $S"
exit 0
# --- node driver ---
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [phase, S, REPO] = process.argv.slice(2)
const MODEL = process.env.LIVE_MODEL ?? 'haiku'
const REPS = Number(process.env.LIVE_REPS ?? 2)
// Every plugin dir under plugins/ that defines agents (ruflo-mods itself has none), so the agent listing is long and real.
const AGENT_PLUGINS = readdirSync(`${REPO}/plugins`).filter(d => d !== 'ruflo-mods' && existsSync(`${REPO}/plugins/${d}/agents`) && readdirSync(`${REPO}/plugins/${d}/agents`).some(f => f.endsWith('.md')))
const AGENT_FILES = AGENT_PLUGINS.reduce((n, d) => n + readdirSync(`${REPO}/plugins/${d}/agents`).filter(f => f.endsWith('.md')).length, 0)
const SECRETISH = /token|account|e-?mail|@[a-z0-9-]+\.|org(anization)?[ _-]?id|telemetry|api[_-]?key|session[_-]?id|bearer|secret|password/i
const clean = text => String(text ?? '').split('\n').filter(l => !SECRETISH.test(l)).join('\n')

const settingsFile = options => {
  const f = join(S, `settings-${Math.random().toString(36).slice(2, 8)}.json`)
  const o = options ? { options } : undefined
  writeFileSync(f, JSON.stringify(o ? { pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } } : {}))
  return f
}
const emptyMcp = join(S, 'mcp-empty.json')
writeFileSync(emptyMcp, JSON.stringify({ mcpServers: {} }))

// The usage ledger ($.store of the inline plugin) is user-global: each session starts from an empty one, and every file is restored at the end.
const STORE_DIR = join(process.env.HOME ?? '', '.claude/plugins/store')
const storeFiles = () => (existsSync(STORE_DIR) ? readdirSync(STORE_DIR) : []).filter(n => /^ruflo-mods_inline-.*\.json$/.test(n)).map(n => join(STORE_DIR, n))
const original = new Map(storeFiles().map(f => [f, readFileSync(f)]))
const resetLedger = () => { for (const f of storeFiles()) original.has(f) ? writeFileSync(f, '{}') : rmSync(f, { force: true }) }
const restoreLedger = () => { for (const f of storeFiles()) if (!original.has(f)) rmSync(f, { force: true }); for (const [f, b] of original) writeFileSync(f, b) }

async function session(prompts, { options, budget = '0.50' } = {}) {
  resetLedger()
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--settings', settingsFile(options),
    '--setting-sources', 'local', '--max-budget-usd', budget, '--allowedTools', 'ToolSearch', '--disallowedTools', 'Bash,Read,Grep,Glob,WebFetch,WebSearch,Edit,Write,NotebookEdit',
    '--strict-mcp-config', '--mcp-config', emptyMcp, '--append-system-prompt', 'Answer exactly as asked, no commentary.']
  for (const d of ['ruflo-mods', ...AGENT_PLUGINS]) args.push('--plugin-dir', `${REPO}/plugins/${d}`)
  const p = spawn('claude', args, { cwd: S, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } })
  p.stderr.on('data', () => {})
  let buf = '', onResult, init
  p.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      try { const m = JSON.parse(line); if (m.type === 'system' && m.subtype === 'init') init = m; if (m.type === 'result' && onResult) onResult(m) } catch {}
    }
  })
  const rows = []
  for (const text of prompts) {
    const done = new Promise(res => { onResult = res })
    p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    const r = await Promise.race([done, new Promise(res => setTimeout(() => res(undefined), 150_000))])
    const u = r?.usage ?? {}
    rows.push({ prompt: text, reply: r?.result ?? '(timeout)', cost: r?.total_cost_usd, usage: { input: u.input_tokens, cacheCreate: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens, output: u.output_tokens } })
  }
  p.stdin.end()
  await new Promise(res => { const t = setTimeout(() => (p.kill(), res()), 15_000); p.on('close', () => (clearTimeout(t), res())) })
  // only counts and names leave the init message: nothing else from it is stored or printed
  const agents = Array.isArray(init?.agents) ? init.agents.filter(a => typeof a === 'string') : []
  return { rows, agentsInInit: agents.length, cost: rows.reduce((n, r) => n + (r.cost ?? 0), 0) }
}
const promptTokens = u => (u.input ?? 0) + (u.cacheCreate ?? 0) + (u.cacheRead ?? 0)
const out = (name, data) => writeFileSync(join(S, name), JSON.stringify(data, null, 2))
const LIST = 'List every subagent_type value your Agent tool accepts, comma-separated, nothing else.'
const OK = 'Reply with the single word ok.'
// split first, filter per token: a benign name ("...:telemetry-analyzer") must not drop its whole line
const parseList = reply => String(reply ?? '').split(/[,\n]/).map(s => s.trim().replace(/^[-*\s]+|[`"'.\s]+$/g, '')).filter(t => /^[A-Za-z0-9:._-]{1,80}$/.test(t) && !SECRETISH.test(t))
const hiddenOf = reply => /(\d+) type\(s\) hidden/.exec(reply)?.[1] ?? 'n/a'
const DOCS = 'ruflo-docs:docs-writer' // an unused, non-core type
// the prompt must not contain the type name or its bare name (the mod keeps a type whose name the prompt contains)
const SPELLED = 'Build a subagent_type string by joining, with no spaces: the text ruflo, a hyphen, the text docs, a colon, the text docs, a hyphen, the text writer.'

console.log(`agent plugins loaded: ${AGENT_PLUGINS.length} (${AGENT_FILES} agent files, plus ruflo-mods); model ${MODEL}`)
try {
  if (phase === 'tokens') {
    const arms = [['off', undefined], ['on', { agentTrim: true }]]
    const results = {}
    for (let r = 0; r < REPS; r++) for (const [arm, options] of arms) {
      const res = await session([OK, '/ruflo-mods'], { options, budget: '0.30' })
      const u = res.rows[0].usage
      console.log(`[tokens ${arm} #${r + 1}] promptTokens=${promptTokens(u)} (input ${u.input}, cacheCreate ${u.cacheCreate}, cacheRead ${u.cacheRead}) output=${u.output} agentsInInit=${res.agentsInInit} cost=$${res.cost?.toFixed(4)}`)
      console.log(clean(res.rows[1].reply).split('\n').filter(l => /agent trim/.test(l)).join('\n'))
      ;(results[arm] ??= []).push({ ...u, promptTokens: promptTokens(u), agentsInInit: res.agentsInInit, hidden: hiddenOf(res.rows[1].reply), cost: res.cost })
    }
    out('tokens.json', results)
    const mean = a => a.reduce((n, x) => n + x.promptTokens, 0) / a.length
    console.log(`[tokens] mean promptTokens off=${mean(results.off)} on=${mean(results.on)} delta=${mean(results.off) - mean(results.on)}`)
  } else if (phase === 'enum') {
    const res = {}
    for (const [arm, options] of [['off', undefined], ['on', { agentTrim: true }]]) {
      const s = await session([LIST, '/ruflo-mods'], { options })
      const names = parseList(s.rows[0].reply)
      res[arm] = { count: names.length, chars: s.rows[0].reply.length, names, hidden: hiddenOf(s.rows[1].reply), promptTokens: promptTokens(s.rows[0].usage) }
      console.log(`[enum ${arm}] model enumerated ${names.length} types (${res[arm].chars} chars); /ruflo-mods hidden=${res[arm].hidden}; cost $${s.cost?.toFixed(4)}`)
      console.log(`[enum ${arm}] ${DOCS} listed: ${names.includes(DOCS)}; sample: ${names.slice(0, 12).join(', ')}`)
    }
    out('enum.json', res)
    if (res.off.count && res.on.count) console.log(`[enum] enumerated-name delta off-on = ${res.off.count - res.on.count} types`)
  } else if (phase === 'spawn') {
    const SPAWN = `${SPELLED} Call the Agent tool once, in the foreground, with that subagent_type, description "hi", prompt "reply with the single word pong". Then reply with only the word ACCEPTED if the call ran, or REFUSED: <error text> if it errored.`
    const SPAWN_NAMED = `Call the Agent tool once, in the foreground, with subagent_type "${DOCS}", description "hi", prompt "reply with the single word pong". Then reply with only the word ACCEPTED if the call ran, or REFUSED: <error text> if it errored.`
    for (const [arm, options, text] of [['trim-off', undefined, SPAWN], ['trim-on', { agentTrim: true }, SPAWN], ['trim-on-prompt-names-type', { agentTrim: true }, SPAWN_NAMED]]) {
      const s = await session([text, '/ruflo-mods'], { options, budget: '0.40' })
      console.log(`[spawn ${arm}] prompt contains type name: ${text.includes(DOCS)} / bare: ${text.includes('docs-writer')}\n[spawn ${arm}] ${clean(s.rows[0].reply).slice(0, 400)}\n[spawn ${arm}] hidden=${hiddenOf(s.rows[1].reply)} cost $${s.cost?.toFixed(4)}`)
      for (const f of storeFiles()) console.log(`[spawn ${arm}] ledger: ${readFileSync(f, 'utf8').replace(/\s+/g, ' ').slice(0, 300)}`)
      out(`spawn-${arm}.json`, { rows: s.rows.map(r => ({ ...r, reply: clean(r.reply) })) })
    }
  } else if (phase === 'named') {
    const NAMED = `Is ${DOCS} one of the subagent_type values your Agent tool accepts? Answer yes or no, then ${LIST}`
    const single = await session([NAMED, '/ruflo-mods'], { options: { agentTrim: true } })
    const a = parseList(single.rows[0].reply)
    console.log(`[named single-prompt] first words: ${clean(single.rows[0].reply).slice(0, 12).replace(/\n/g, ' ')} | ${DOCS} in list: ${a.includes(DOCS)} (${a.length} listed) hidden=${hiddenOf(single.rows[1].reply)}`)
    const multi = await session([OK, NAMED, '/ruflo-mods'], { options: { agentTrim: true } })
    const b = parseList(multi.rows[1].reply)
    console.log(`[named second-turn] first words: ${clean(multi.rows[1].reply).slice(0, 12).replace(/\n/g, ' ')} | ${DOCS} in list: ${b.includes(DOCS)} (${b.length} listed) hidden=${hiddenOf(multi.rows[2].reply)}`)
    out('named.json', { single: { listed: a.length, has: a.includes(DOCS) }, second: { listed: b.length, has: b.includes(DOCS) } })
  } else { console.error(`unknown phase ${phase}`); process.exitCode = 2 }
} finally { restoreLedger() }
process.exit(process.exitCode ?? 0)
