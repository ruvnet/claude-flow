#!/usr/bin/env bash
# Live verification of ruflo-mods (toolHints, agentTrim, /ruflo-mods status) against REAL headless Claude Code sessions.
#   scripts/live-ruflo-mods.sh [status hints trim ledger spawn | all]   (default: all)
# Everything runs in a private mktemp scratch project; results land in $S/*.json and are printed.
# Spend: haiku only (about $0.5 for `all`). Env: LIVE_MODEL, LIVE_MCP_CMD (the `ruflo` MCP server that owns the hinted tools).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="${LIVE_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/mods-live.XXXXXX")}"
PHASES=("$@"); [ ${#PHASES[@]} -eq 0 ] && PHASES=(all)
[ "${PHASES[0]}" = all ] && PHASES=(status hints trim ledger spawn)
mkdir -p "$S"; [ -d "$S/.git" ] || (cd "$S" && git init -q)
echo "scratch: $S"
sed -n '/^# --- node driver ---$/,$p' "$0" | sed 1d >"$S/live.mjs"
for p in "${PHASES[@]}"; do echo "== phase: $p"; node "$S/live.mjs" "$p" "$S" "$REPO" || echo "phase $p exited $?"; done
echo "results: $S"
exit 0
# --- node driver ---
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [phase, S, REPO] = process.argv.slice(2)
const PLUG = `${REPO}/plugins/ruflo-mods`
const MODEL = process.env.LIVE_MODEL ?? 'haiku'
const MCP = process.env.LIVE_MCP_CMD ?? 'npx -y @claude-flow/cli@latest mcp start'
const out = (name, data) => writeFileSync(join(S, name), JSON.stringify(data, null, 2))
const AGENTS = {
  coder: { description: 'Writes code', prompt: 'You write code.' },
  reviewer: { description: 'Reviews code', prompt: 'You review code.' },
  'zebra-specialist': { description: 'Zebra stripes expert', prompt: 'You know zebras.' },
  'quokka-analyst': { description: 'Quokka analytics expert', prompt: 'You know quokkas.' },
  'yak-planner': { description: 'Yak shaving planner', prompt: 'You plan yaks.' },
}
const HINTS = {
  memory_search: 'Searches AgentDB only; memory_search_unified also covers Claude memories and patterns.',
  swarm_init: 'For coding work use topology hierarchical, maxAgents 6-8, strategy specialized.',
}
const settingsFile = options => {
  const f = join(S, `settings-${Math.random().toString(36).slice(2, 8)}.json`)
  const o = options ? { options } : undefined
  writeFileSync(f, JSON.stringify(o ? { pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } } : {}))
  return f
}
const mcpFile = () => { const f = join(S, 'mcp.json'); writeFileSync(f, JSON.stringify({ mcpServers: { ruflo: { command: 'sh', args: ['-c', MCP], env: { CLAUDE_FLOW_MCP_TRANSPORT: 'stdio' } } } })); return f }

// One headless process, several prompts (a `/ruflo-mods` prompt is answered by the mod itself, no model call).
async function session(prompts, { options, mcp = false, agents = false, budget = '0.50', env = {} }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--plugin-dir', PLUG, '--settings', settingsFile(options),
    '--setting-sources', 'local', '--max-budget-usd', budget, '--allowedTools', 'ToolSearch', '--disallowedTools', 'Bash,Read,Grep,Glob,WebFetch,WebSearch,Edit,Write,NotebookEdit', '--append-system-prompt', 'Answer exactly as asked, no commentary.']
  if (mcp) args.push('--strict-mcp-config', '--mcp-config', mcpFile())
  if (agents) args.push('--agents', JSON.stringify(AGENTS))
  const p = spawn('claude', args, { cwd: S, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } })
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
    const r = await Promise.race([done, new Promise(res => setTimeout(() => res(undefined), 120_000))])
    rows.push({ prompt: text, reply: r?.result ?? '(timeout)', cost: r?.total_cost_usd })
  }
  p.stdin.end()
  await new Promise(res => { const t = setTimeout(() => (p.kill(), res()), 15_000); p.on('close', () => (clearTimeout(t), res())) })
  return { rows, init, cost: rows.at(-1)?.cost }
}
const show = (name, res) => { out(`${name}.json`, { ...res, init: { agents: res.init?.agents, plugins: res.init?.plugins } }); for (const r of res.rows) console.log(`[${name}] > ${r.prompt.slice(0, 90)}\n${r.reply}\n`); console.log(`[${name}] cost $${res.cost}`) }

const LIST = 'List every subagent_type value your Agent tool accepts, comma-separated, nothing else.'
const DESCR = 'Use ToolSearch with query "select:mcp__ruflo__memory_search,mcp__ruflo__swarm_init,mcp__ruflo__memory_list". Then print, for each of the three tools, its tool name followed by its full description text verbatim, nothing else.'

async function status() { // no model call: the mod answers /ruflo-mods itself
  for (const [name, options] of [['status-default', undefined], ['status-on', { toolHints: true, agentTrim: true }]]) show(name, await session(['/ruflo-mods'], { options, env: { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } }))
}
async function hints() {
  show('hints-off', await session([DESCR, '/ruflo-mods'], { mcp: true }))
  show('hints-on', await session([DESCR, '/ruflo-mods'], { options: { toolHints: true }, mcp: true }))
}
async function trim() {
  show('trim-off', await session([LIST, '/ruflo-mods'], { agents: true }))
  show('trim-on', await session([LIST, '/ruflo-mods'], { options: { agentTrim: true }, agents: true }))
  show('trim-on-keep', await session([LIST, '/ruflo-mods'], { options: { agentTrim: true, agentTrimKeep: 'zebra-specialist' }, agents: true }))
  show('trim-on-named', await session(['Is quokka-analyst available? Answer yes/no, then ' + LIST, '/ruflo-mods'], { options: { agentTrim: true }, agents: true }))
}
// The usage ledger is $.store of the inline plugin: ~/.claude/plugins/store/ruflo-mods_inline-<hash>.json. It is user-global, so the harness
// snapshots every such file and restores it after each phase: a run must not change what a later real session hides.
const STORE_DIR = join(process.env.HOME ?? '', '.claude/plugins/store')
const storeFiles = () => readdirSync(STORE_DIR).filter(n => /^ruflo-mods_inline-.*\.json$/.test(n)).map(n => join(STORE_DIR, n))
async function withLedger(content, run) {
  const saved = new Map(storeFiles().map(f => [f, readFileSync(f)]))
  if (!saved.size) throw new Error('no ruflo-mods inline store file yet: run the spawn phase first')
  try {
    for (const f of saved.keys()) writeFileSync(f, content)
    return await run()
  } finally { for (const [f, b] of saved) writeFileSync(f, b) }
}
const DAY = 86_400_000
async function ledger() { // a recent spawn keeps a type, an old one does not, a corrupt file must not break the session or the core roles
  const now = Date.now()
  const cases = [
    ['ledger-recent-and-stale', JSON.stringify({ agentUse: { 'quokka-analyst': now - DAY, 'yak-planner': now - 40 * DAY } })],
    ['ledger-corrupt-text', '{ this is not json'],
    ['ledger-wrong-shape', JSON.stringify({ agentUse: ['quokka-analyst'] })],
    ['ledger-hostile-values', JSON.stringify({ agentUse: { 'quokka-analyst': 'now', 'zebra-specialist': -1 } })],
  ]
  for (const [name, content] of cases) show(name, await withLedger(content, () => session([LIST, '/ruflo-mods'], { options: { agentTrim: true }, agents: true })))
}
async function spawn_() { // dispatch of a hidden type: is it refused, and does the accepted spawn land in the ledger?
  const SPAWN = 'Call the Agent tool once, in the foreground, with subagent_type "quokka-analyst", description "hi", prompt "reply with the single word pong". Then reply with only the word ACCEPTED if the call ran, or REFUSED: <error text> if it errored.'
  const before = new Map(storeFiles().map(f => [f, readFileSync(f)]))
  try {
    for (const f of before.keys()) writeFileSync(f, '{}')
    show('spawn-hidden-type', await session([SPAWN, '/ruflo-mods'], { options: { agentTrim: true }, agents: true, budget: '0.40' }))
    for (const f of storeFiles()) console.log('[spawn] ledger after:', readFileSync(f, 'utf8').replace(/\s+/g, ' '))
  } finally { for (const [f, b] of before) writeFileSync(f, b) }
}
const PHASE = { status, hints, trim, ledger, spawn: spawn_ }
if (!PHASE[phase]) { console.error(`unknown phase ${phase}`); process.exit(2) }
await PHASE[phase]()
process.exit(0)
