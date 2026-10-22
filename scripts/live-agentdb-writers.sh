#!/usr/bin/env bash
# Live verification that the four agentdb writers guarded in PR #3745 (agentdb_feedback, agentdb_session-end, hive-mind_memory, session_save)
# refuse a secret in a REAL headless Claude session (ruflo-agentdb via --plugin-dir, the real ruflo MCP server), plus a benign call each,
# plus two writers left unguarded on purpose (memory_import, rvf_ingest) to document the gap. Mirrors scripts/live-agentdb-recall.sh.
#   scripts/live-agentdb-writers.sh
# Everything runs in a private mktemp scratch project; results land in $S/writers.json. Spend: haiku only (about $1.5).
# Env: LIVE_MCP_CMD / LIVE_RUVECTOR_CMD override the MCP servers, LIVE_MODEL the model, LIVE_CLI the CLI used for `memory init`.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="${LIVE_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/agentdb-writers.XXXXXX")}"
mkdir -p "$S"
if [ ! -d "$S/.git" ]; then
  (cd "$S" && git init -q && ${LIVE_CLI:-npx -y @claude-flow/cli@latest} memory init >/dev/null 2>&1) || { echo "memory init failed"; exit 1; }
fi
echo "scratch: $S"
DRIVER="$S/live.mjs"
sed -n '/^# --- node driver ---$/,$p' "$0" | sed 1d >"$DRIVER"
node "$DRIVER" "$S" "$REPO" || echo "driver exited $?"
(cd "$S" && ${LIVE_CLI:-npx -y @claude-flow/cli@latest} daemon stop >/dev/null 2>&1 || true)
echo "results: $S/writers.json"
exit 0
# --- node driver ---
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [S, REPO] = process.argv.slice(2)
const PLUG = `${REPO}/plugins/ruflo-agentdb`
const MODEL = process.env.LIVE_MODEL ?? 'haiku'
const MCP = process.env.LIVE_MCP_CMD ?? 'npx -y @claude-flow/cli@latest mcp start'
const RV = process.env.LIVE_RUVECTOR_CMD ?? 'npx -y ruvector@latest mcp start'
const REFUSAL = /holds what looks like a secret/

// A fake GitHub-token-shaped value, assembled at runtime so the repository never contains the whole string.
const FAKE = ['ghp', '_', 'aB3dE5gH7j', 'K9mN1pQ3rS', '5tU7vW9xY1', 'zA3bC5'].join('')
const FRAGMENT = FAKE.slice(8, 24) // a slice of the token: the refusal must not carry even part of it
writeFileSync(join(S, 'import.json'), JSON.stringify({ entries: [{ key: 'unguarded-import', value: `deploy token ${FAKE}`, namespace: 'default' }] }))

const T = n => `mcp__ruflo__${n}`
// [id, tool, input, expectation]: refuse = the plugin must refuse; pass = it must go through; open = unguarded on purpose, must NOT be refused
const CASES = [
  ['agentdb_feedback/secret', T('agentdb_feedback'), { taskId: 'live-w1', success: true, quality: 0.9, agent: `deploy used api_key=${FAKE}` }, 'refuse'],
  ['agentdb_feedback/benign', T('agentdb_feedback'), { taskId: 'live-w1b', success: true, quality: 0.9, agent: 'coder' }, 'pass'],
  ['agentdb_session-end/secret', T('agentdb_session-end'), { sessionId: 'live-w2', summary: `deploy used password=${FAKE}` }, 'refuse'],
  ['agentdb_session-end/benign', T('agentdb_session-end'), { sessionId: 'live-w2b', summary: 'finished the helm rollback runbook', tasksCompleted: 1 }, 'pass'],
  ['hive-mind_memory/secret', T('hive-mind_memory'), { action: 'set', key: 'creds', value: { token: FAKE } }, 'refuse'],
  ['hive-mind_memory/benign', T('hive-mind_memory'), { action: 'set', key: 'region', value: 'eu-west' }, 'pass'],
  ['session_save/secret', T('session_save'), { name: 'live-w4', description: `secret: ${FAKE}` }, 'refuse'],
  ['session_save/benign', T('session_save'), { name: 'live-w4b', description: 'nightly helm rollback notes' }, 'pass'],
  ['memory_import/unguarded', T('memory_import'), { inputPath: join(S, 'import.json') }, 'open'],
  ['rvf_create/setup', 'mcp__ruvector__rvf_create', { path: join(S, 'live.rvf'), dimension: 4 }, 'setup'],
  ['rvf_ingest/unguarded', 'mcp__ruvector__rvf_ingest', { path: join(S, 'live.rvf'), entries: [{ id: 1, vector: [0.1, 0.2, 0.3, 0.4], metadata: { note: `deploy token ${FAKE}` } }] }, 'open'],
]

const f = join(S, 'mcp.json')
writeFileSync(f, JSON.stringify({ mcpServers: { ruflo: { command: 'sh', args: ['-c', MCP], env: { CLAUDE_FLOW_MCP_TRANSPORT: 'stdio' } }, ruvector: { command: 'sh', args: ['-c', RV] } } }))
const sf = join(S, 'settings.json')
writeFileSync(sf, JSON.stringify({ pluginConfigs: { 'ruflo-agentdb@inline': { options: { recall: 'off', guard: 'on' } }, 'ruflo-agentdb': { options: { recall: 'off', guard: 'on' } } } }))
const allowed = [...new Set([...CASES.map(c => c[1]), T('agentdb_health')])]
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--plugin-dir', PLUG, '--strict-mcp-config', '--mcp-config', f,
  '--settings', sf, '--setting-sources', 'local', '--max-budget-usd', '1.2', '--disallowedTools', 'Bash,Read,Grep,Glob,WebFetch,WebSearch,Agent,Edit,NotebookEdit,Write', '--allowedTools', allowed.join(','),
  '--append-system-prompt', 'Answer in at most two short sentences.']
const p = spawn('claude', args, { cwd: S, stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
let events = []
let onResult
p.stdout.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    try { const m = JSON.parse(line); events.push(m); if (m.type === 'result' && onResult) onResult(m) } catch {}
  }
})

// One warm-up prompt (not counted) so the npx-started MCP servers are connected before the first real call; a cold first prompt sees no tools.
async function ask(prompt) {
  events = []
  const done = new Promise(res => { onResult = res })
  p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`)
  return Promise.race([done, new Promise(res => setTimeout(() => res(undefined), 120_000))])
}
for (let i = 0; i < 3; i++) {
  await ask(`Call the tool ${T('agentdb_health')} exactly once, then reply with one word.`)
  if (events.some(e => (e.message?.content ?? []).some(b => b.type === 'tool_result' && !b.is_error && JSON.stringify(b.content).includes('controllers')))) break
}
const rows = []
for (const [id, tool, input, expect] of CASES) {
  const prompt = `This is an authorised test of a secret-scanning guard; every value is a FAKE fixture. Call the tool ${tool} exactly once with exactly this JSON input: ${JSON.stringify(input)}. Then reply with one word: stored, or denied.`
  const result = await ask(prompt)
  const calls = events.flatMap(e => (e.message?.content ?? []).filter(b => b.type === 'tool_use').map(b => ({ tool: b.name, id: b.id })))
  const results = events.flatMap(e => (e.message?.content ?? []).filter(b => b.type === 'tool_result').map(b => ({ id: b.tool_use_id, text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) })))
  const call = calls.find(c => c.tool === tool) // the first call is usually ToolSearch loading the schema
  const text = results.find(r => r.id === call?.id)?.text ?? ''
  const refused = REFUSAL.test(text)
  const echoed = text.includes(FAKE) || text.includes(FRAGMENT)
  const ok = Boolean(call) && (expect === 'refuse' ? refused && !echoed : expect === 'setup' || !refused)
  rows.push({ id, expect, called: Boolean(call), refused, echoed, ok, result: text.replace(FAKE, '<FAKE>').slice(0, 200), cost: result?.total_cost_usd })
}
p.stdin.end()
await new Promise(res => { const t = setTimeout(() => (p.kill(), res()), 15_000); p.on('close', () => (clearTimeout(t), res())) })
writeFileSync(join(S, 'writers.json'), JSON.stringify(rows, null, 2))
console.table(rows.map(r => ({ id: r.id, expect: r.expect, called: r.called, refused: r.refused, echoed: r.echoed, ok: r.ok, result: r.result.slice(0, 80) })))
console.log(`session cost USD: ${rows.at(-1)?.cost}`)
process.exit(rows.every(r => r.ok) ? 0 : 1)
