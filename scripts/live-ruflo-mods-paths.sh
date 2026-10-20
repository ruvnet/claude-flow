#!/usr/bin/env bash
# Live proof of the ruflo-mods paths the capability review marks "no" (v3/docs/validation/mod-capability-review-2026-10.md):
# prompt.submit routing context, a tool.check deny, the session heartbeat file, and the /ruflo-mods command, each against a REAL
# headless Claude Code session with the plugin loaded by --plugin-dir. Method follows scripts/live-ruflo-mods.sh.
#   scripts/live-ruflo-mods-paths.sh [route deny status command | all]   (default: all)
# Everything runs in private mktemp scratch projects. Spend: haiku only (about $1 for `all`). Env: LIVE_MODEL.
# The deny probe uses `echo <entry> > ran.txt` for a dangerous-list entry that is inert on Linux: a block leaves no ran.txt.
# Output is screened: a reply that looks like auth/account/telemetry content is withheld and counted, never printed or stored.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="${LIVE_SCRATCH:-$(mktemp -d "${TMPDIR:-/tmp}/mods-paths.XXXXXX")}"
PHASES=("$@"); [ ${#PHASES[@]} -eq 0 ] && PHASES=(all)
[ "${PHASES[0]}" = all ] && PHASES=(route deny status command)
mkdir -p "$S"
echo "scratch: $S"
sed -n '/^# --- node driver ---$/,$p' "$0" | sed 1d >"$S/live.mjs"
for p in "${PHASES[@]}"; do echo "== phase: $p"; node "$S/live.mjs" "$p" "$S" "$REPO" || echo "phase $p exited $?"; done
echo "results: $S"
exit 0
# --- node driver ---
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [phase, S, REPO] = process.argv.slice(2)
const PLUG = `${REPO}/plugins/ruflo-mods`
const MODEL = process.env.LIVE_MODEL ?? 'haiku'
const AUTHLIKE = /bearer\s|authorization|api[_-]?key|sk-ant|oauth|access[_-]?token|refresh[_-]?token|account[_ -]?(id|uuid)|organization|[\w.+-]+@[\w-]+\.[a-z]{2,}/i
let withheld = 0
const clean = text => (AUTHLIKE.test(text ?? '') ? (withheld++, '[withheld: auth-like content]') : text)
const DANGER = 'format c:' // a DANGEROUS_COMMANDS entry that does nothing on Linux

// A fresh scratch project per session: `.claude-flow/` is the opt-in boundary the mod checks.
function project(name, { claudeFlow = true } = {}) {
  const dir = join(S, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (claudeFlow) mkdirSync(join(dir, '.claude-flow'), { recursive: true })
  return dir
}
const settingsFile = (dir, options) => {
  const f = join(S, `settings-${Math.random().toString(36).slice(2, 8)}.json`)
  const o = options ? { options } : undefined
  writeFileSync(f, JSON.stringify(o ? { pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } } : {}))
  return f
}

async function session(dir, prompts, { plugin = true, options, tools = [], budget = '0.30' } = {}) {
  const denied = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', ...(tools.includes('Bash') ? [] : ['Bash'])]
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL,
    '--settings', settingsFile(dir, options), '--setting-sources', 'local', '--max-budget-usd', budget,
    '--allowedTools', tools.join(',') || 'ToolSearch', '--disallowedTools', denied.join(','),
    '--append-system-prompt', 'Answer exactly as asked, no commentary.']
  if (plugin) args.push('--plugin-dir', PLUG)
  const p = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } })
  let buf = '', onResult, init
  const toolRows = []
  p.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      try {
        const m = JSON.parse(line)
        if (m.type === 'system' && m.subtype === 'init') init = m
        if (m.type === 'result' && onResult) onResult(m)
        for (const c of Array.isArray(m.message?.content) ? m.message.content : []) {
          if (c.type === 'tool_use') toolRows.push({ use: c.name, input: c.input?.command ?? '' })
          if (c.type === 'tool_result') toolRows.push({ result: typeof c.content === 'string' ? c.content : JSON.stringify(c.content), error: !!c.is_error })
        }
      } catch {}
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
  const loaded = (init?.plugins ?? []).map(x => x.name ?? String(x)).filter(n => /ruflo-mods/.test(n))
  return { rows, toolRows, loaded, cost: rows.at(-1)?.cost }
}
const show = (name, res) => {
  console.log(`[${name}] plugin loaded: ${res.loaded.length ? res.loaded.join(',') : 'no'}`)
  for (const r of res.rows) console.log(`[${name}] > ${r.prompt.slice(0, 110)}\n${clean(r.reply)}`)
  for (const t of res.toolRows) console.log(`[${name}] tool ${t.use ? `call: ${clean(`${t.use} ${t.input}`)}` : `${t.error ? 'ERROR ' : 'result: '}${clean(t.result).slice(0, 300)}`}`)
  console.log(`[${name}] cost $${res.cost}\n`)
}
const ROUTE = text => `Look in your context for a block that starts with the line "[INFO] Routing task:". If present, copy the whole block verbatim (the INFO line, Agent, Confidence, Reason lines) and nothing else. If there is no such block, reply exactly NONE. The task for this turn: ${text}`
const RUN = (cmd, ending) => `Run this exact shell command with the Bash tool and then reply ${ending}: ${cmd}`
const BAD = RUN(`echo ${DANGER} > ran.txt`, 'with only the word RAN, or with DENIED: <error text> if the call was refused')
const GOOD = RUN('echo hello > ran.txt', 'with only the word RAN, or with DENIED: <error text> if the call was refused')

async function route() {
  const T = 'write a unit test for the parser'
  for (const [name, task, o] of [['route-on-keyword', T], ['route-on-nomatch', 'zzz qqq'], ['route-ranked-block-off', T, { routeContext: false }]]) {
    show(name, await session(project(name), [ROUTE(task)], { options: o }))
  }
  show('route-no-plugin', await session(project('route-no-plugin'), [ROUTE(T)], { plugin: false }))
}
async function deny() {
  for (const [name, prompt, plugin] of [['deny-on-dangerous', BAD, true], ['deny-on-benign', GOOD, true], ['deny-control-no-plugin', BAD, false]]) {
    const d = project(name)
    show(name, await session(d, [prompt], { plugin, tools: ['Bash'] }))
    const f = join(d, 'ran.txt')
    console.log(`[${name}] ran.txt after the session: ${existsSync(f) ? `exists: ${JSON.stringify(readFileSync(f, 'utf8').trim())}` : 'absent'}\n`)
  }
}
async function status() { // the heartbeat the mod writes for `ruflo mods doctor`; no model call (the mod answers /ruflo-mods)
  const d = project('status-project')
  const file = join(d, '.claude-flow/mods/session.json')
  console.log(`[status-project] before: ${existsSync(file) ? 'exists' : 'absent'}`)
  show('status-project', await session(d, ['/ruflo-mods']))
  console.log(`[status-project] .claude-flow/mods/session.json: ${existsSync(file) ? readFileSync(file, 'utf8').replace(/\s+/g, ' ') : 'absent'}\n`)
  const bare = project('status-no-opt-in', { claudeFlow: false })
  show('status-no-opt-in', await session(bare, ['/ruflo-mods']))
  console.log(`[status-no-opt-in] .claude-flow created: ${existsSync(join(bare, '.claude-flow')) ? 'yes' : 'no'}\n`)
}
async function command() { // counters read by /ruflo-mods in the same session, before and after a routed prompt and a refused call
  show('command-counters', await session(project('command-counters'), ['/ruflo-mods', ROUTE('write a unit test for the parser'), BAD, '/ruflo-mods'], { tools: ['Bash'], budget: '0.40' }))
}
const PHASE = { route, deny, status, command }
if (!PHASE[phase]) { console.error(`unknown phase ${phase}`); process.exit(2) }
await PHASE[phase]()
console.log(`replies withheld as auth-like: ${withheld}`)
process.exit(0)
