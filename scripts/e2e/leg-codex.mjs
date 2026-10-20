// Codex leg (ADR-490). PINNED to Codex 0.162.0: the 0.162.1 build crashes with a #GP (stack misalignment), so this leg calls the 0.162.0 binary by
// path, never `codex` from PATH and never touching the `current` links. Isolated CODEX_HOME; auth is copied WITHOUT the refresh token.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { recorder, sandbox, run, spend, redact } from './lib.mjs'
import { findOpenRouterKey } from './leg-openrouter.mjs'

const REPO = resolve(new URL('../..', import.meta.url).pathname)
const PIN = '0.162.0'

function findCodex() {
  if (process.env.RUFLO_E2E_CODEX_BIN) return process.env.RUFLO_E2E_CODEX_BIN
  const dir = join(homedir(), '.codex/packages/standalone/releases')
  try { const d = readdirSync(dir).find(n => n.startsWith(`${PIN}-`)); return d ? join(dir, d, 'bin/codex') : undefined } catch { return undefined }
}

export async function codexLeg({ cli, live }) {
  const rec = recorder('codex')
  const bin = findCodex()
  const ver = bin && existsSync(bin) ? (await run(bin, ['--version'], { timeout: 20_000 })).out.trim() : ''
  if (!ver.endsWith(PIN)) { rec.blocked('codex 0.162.0 binary available', `pinned binary not found (looked for ${PIN}); 0.162.1 is excluded on purpose (#GP crash)`); return rec.rows }
  rec.pass('codex binary is the pinned 0.162.0 (not the crashing 0.162.1)', ver)
  const sb = sandbox('e2e-codex.')
  const codexHome = join(sb.home, '.codex')
  mkdirSync(codexHome, { recursive: true })
  const env = { ...sb.env, CODEX_HOME: codexHome }
  const proj = sb.project('proj')
  await run('git', ['init', '-q'], { cwd: proj, env })
  try {
    const init = await run(cli.cmd, [...cli.args, 'init', '--dual', '--no-plugin-install', '--no-signup', '--no-global'], { cwd: proj, env, timeout: 300_000 })
    rec.check('init --dual: exits 0 and writes AGENTS.md + .agents/config.toml', init.code === 0 && existsSync(join(proj, 'AGENTS.md')) && existsSync(join(proj, '.agents/config.toml')), `exit=${init.code} ${init.err.slice(-120)}`)
    const local = existsSync(join(proj, '.codex/config.toml')) ? readFileSync(join(proj, '.codex/config.toml'), 'utf8') : ''
    const permissive = /^\s*sandbox_mode\s*=\s*"danger-full-access"/m.test(local) && /^\s*approval_policy\s*=\s*"never"/m.test(local)
    rec.check('init --dual: the generated .codex/config.toml does not default to danger-full-access + approval never', !permissive, permissive ? 'ADVISORY: gitignored local override ships sandbox_mode=danger-full-access, approval_policy=never, web_search=live' : 'restrictive default', permissive ? { advisory: true } : {})

    // `init --dual` registers the ruflo marketplace and installs ruflo-core@ruflo itself (#2801). On a fresh CODEX_HOME that must just work.
    const whichCodex = await run(process.execPath, ['-e', "const{execSync}=require('child_process');try{console.log('OK',execSync('which codex',{stdio:'pipe'}).toString().trim())}catch(e){console.log('THROW status='+e.status,'stderr='+String(e.stderr).slice(0,120),'msg='+String(e.message).slice(0,120))};console.log('PATH='+process.env.PATH.slice(0,200))"], { cwd: proj, env, timeout: 10_000 })
    const afterInit = await run(bin, ['plugin', 'list'], { cwd: proj, env, timeout: 60_000 })
    const installedAfterInit = /ruflo-core@ruflo\s+installed/.test(afterInit.out)
    const initSawNoCodex = /Codex CLI not found/.test(`${init.out}${init.err}`) && /^OK /.test(whichCodex.out)
    const initEvidence = (afterInit.out.match(/ruflo-core@ruflo.*/) ?? [`not listed. list exit=${afterInit.code} out=${afterInit.out.replace(/\s+/g, ' ').slice(0, 120)} err=${redact(afterInit.err).replace(/\s+/g, ' ').slice(0, 120)} | shell sees: ${whichCodex.out.replace(/\s+/g, ' ').slice(0, 260)} | init said: ${redact(`${init.out}\n${init.err}`).split('\n').filter(l => !/mods|enabledPlugins|settings\.json|Transformers/i.test(l)).slice(-40).join('\n')} | filtered: ${redact(`${init.out}\n${init.err}`).split('\n').filter(l => /codex|marketplace|ruflo-core|Failed to install|Install manually/i.test(l) && !/mods|enabledPlugins|settings\.json/i.test(l)).join(' / ').replace(/\s+/g, ' ').slice(0, 700)}`])[0].slice(0, 2600)
    // GitHub-hosted runners: init says "Codex CLI not found" while the same env resolves codex (cause not found after 5 CI iterations; passes on three local setups).
    // That is an environment finding, not a pass: report it as flaky with the evidence, never as green.
    if (!installedAfterInit && initSawNoCodex) rec.flaky('init --dual on a fresh CODEX_HOME leaves ruflo-core@ruflo installed (marketplace clone must outlast the init timeout)', `init could not see the codex binary that the sandbox shell resolves (seen on GitHub-hosted runners only). ${initEvidence}`)
    else rec.check('init --dual on a fresh CODEX_HOME leaves ruflo-core@ruflo installed (marketplace clone must outlast the init timeout)', installedAfterInit, initEvidence, { long: true })
    // Then swap in the CHECKOUT as a local marketplace, so the remaining assertions test this tree, not main on GitHub.
    await run(bin, ['plugin', 'marketplace', 'remove', 'ruflo'], { cwd: proj, env, timeout: 60_000 })
    const mk = await run(bin, ['plugin', 'marketplace', 'add', REPO], { cwd: proj, env, timeout: 120_000 })
    rec.check('codex plugin marketplace add <checkout>: accepted', mk.code === 0, redact(`${mk.out}${mk.err}`).split('\n').filter(l => !/PATH aliases/.test(l)).join(' ').slice(0, 160))
    const list = await run(bin, ['plugin', 'list'], { cwd: proj, env, timeout: 60_000 })
    rec.check('codex sees the ruflo plugins (ruflo-core, ruflo-swarm) from the Claude-format marketplace.json', /ruflo-core@ruflo/.test(list.out) && /ruflo-swarm@ruflo/.test(list.out), `${(list.out.match(/@ruflo/g) ?? []).length} plugins listed`)
    const add = await run(bin, ['plugin', 'add', 'ruflo-swarm@ruflo'], { cwd: proj, env, timeout: 60_000 })
    const installed = /Installed plugin root: (.+)/.exec(add.out)?.[1]
    rec.check('codex plugin add ruflo-swarm@ruflo installs, and its Codex hook manifest is present and valid JSON', add.code === 0 && !!installed && (() => { try { JSON.parse(readFileSync(join(installed, 'hooks/codex-hooks.json'), 'utf8')); return true } catch { return false } })(), installed ? 'installed' : redact(add.err).slice(0, 140))
    await run(bin, ['plugin', 'add', 'ruflo-core@ruflo'], { cwd: proj, env, timeout: 60_000 }) // its lifecycle hooks (telemetry only) are what a Codex user gets from init --dual
    const hooks = (() => { try { return JSON.parse(readFileSync(join(REPO, 'plugins/ruflo-swarm/hooks/codex-hooks.json'), 'utf8')).hooks } catch { return undefined } })()
    rec.check('ruflo-swarm Codex manifest is a deliberate no-op (hooks == {}), so no ruflo policy runs on Codex through it', hooks && Object.keys(hooks).length === 0, JSON.stringify(hooks))
    // Registers ruflo as an MCP server exactly as a user would, then reads it back.
    const mcp = await run(bin, ['mcp', 'add', 'ruflo', '--', ...(cli.cmd === 'npx' ? ['npx'] : [cli.cmd]), ...cli.args, 'mcp', 'start'], { cwd: proj, env, timeout: 60_000 })
    const got = await run(bin, ['mcp', 'list'], { cwd: proj, env, timeout: 60_000 })
    rec.check('codex mcp add/list: ruflo registered', mcp.code === 0 && /ruflo/.test(got.out), got.out.split('\n').find(l => /ruflo/.test(l)) ?? redact(mcp.err).slice(0, 120))
    const led = await run(process.execPath, [join(REPO, 'plugins/ruflo-cost-tracker/scripts/test-ledger.mjs')], { cwd: REPO, env: { ...process.env }, timeout: 120_000 })
    rec.check("cost-tracker: Codex rollout ledger tests pass, incl. session ownership (#4047/#4048)", led.code === 0, led.out.trim().split('\n').slice(-1)[0] || led.err.slice(0, 120))
  } catch (e) { rec.fail('keyless leg ran to completion', redact(String(e?.stack ?? e)).slice(0, 300)) }

  if (!live) { rec.skipped('live: codex exec with ruflo MCP + hook-event probe', 'RUFLO_E2E_LIVE not set'); sb.cleanup(); return rec.rows }
  await liveCodex({ bin, cli, rec, sb, env, codexHome, proj })
  sb.cleanup()
  return rec.rows
}

const MODEL = process.env.RUFLO_E2E_CODEX_MODEL ?? 'openai/gpt-5.1-codex-mini' // gpt-5-mini often answered via read_mcp_resource instead of calling the tools; this one called them 3/3

async function usageNow(key) {
  try { const j = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } }).then(r => r.json()); return Number(j?.data?.usage) } catch { return NaN }
}

async function liveCodex({ bin, cli, rec, sb, env, codexHome, proj }) {
  // Default live path: Codex 0.162.0 with OpenRouter as its model provider (Responses wire). It needs no ChatGPT login, so it cannot disturb the
  // real one: the ChatGPT refresh token is single-use and a throwaway home that refreshed it would invalidate ~/.codex/auth.json. The
  // ChatGPT-auth variant exists only behind RUFLO_E2E_CODEX_AUTH=chatgpt, and is documented in ADR-490 as unsafe to run unattended.
  const key = findOpenRouterKey()
  if (!key) return rec.blocked('live: codex exec via OpenRouter', 'no OPENROUTER_API_KEY in env or GCP Secret Manager')
  env.OPENROUTER_API_KEY = key
  const before = await usageNow(key)
  // Probe hook: records which Codex hook events fire (event name only), so the mods-policy table below is evidence, not documentation.
  const probe = join(sb.home, 'hook-probe.mjs'), log = join(sb.home, 'hook-events.log')
  writeFileSync(probe, `import{appendFileSync}from'node:fs';let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch{}appendFileSync(${JSON.stringify(log)},(j.hook_event_name||process.argv[2])+'\\n');process.stdout.write('{}')})\n`)
  const ev = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PermissionRequest']
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(ev.map(e => [e, [{ hooks: [{ type: 'command', command: `${process.execPath} ${probe} ${e}`, timeout: e === 'SessionEnd' ? 3 : 10 }] }]])) }))
  writeFileSync(join(codexHome, 'config.toml'), [`model = "${MODEL}"`, 'model_provider = "openrouter"', 'model_reasoning_effort = "low"', '[features]', 'hooks = true', '', '[model_providers.openrouter]', 'name = "OpenRouter"', 'base_url = "https://openrouter.ai/api/v1"', 'env_key = "OPENROUTER_API_KEY"', 'wire_api = "responses"', '', '[mcp_servers.ruflo]', `command = ${JSON.stringify(cli.cmd)}`, `args = ${JSON.stringify([...cli.args, 'mcp', 'start'])}`, 'startup_timeout_sec = 120', 'default_tools_approval_mode = "approve"', ''].join('\n'))
  const canary = `cx${Math.random().toString(36).slice(2, 8)}`
  const t0 = Date.now()
  const prompt = `Use the MCP tool memory_store from the server named ruflo (call the tool directly; do not list resources first) with key "${canary}", value "codex-value-${canary}", namespace "e2elive". Then call memory_search from the same server with query "codex-value-${canary}" and namespace "e2elive". Reply with only the key you found, or NOT_FOUND.`
  let r, events, calls, attempts = 0
  do {
    attempts++
    r = await run(bin, ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-s', 'read-only', prompt], { cwd: proj, env, timeout: 300_000 })
    events = r.out.split('\n').map(l => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
    calls = events.filter(e => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call' && e.item.server === 'ruflo')
  } while (!calls.some(e => !e.item.error) && attempts < 2) // one retry: a small model sometimes answers without calling the tool; the harness records the attempts
  const text = redact(r.out)
  const final = [...events].reverse().map(e => e.item?.text ?? e.message ?? '').find(Boolean) ?? ''
  const finalMsg = [...events].reverse().find(e => e.item?.type === 'agent_message')?.item?.text ?? ''
  rec.check('live: codex exec (OpenRouter provider, read-only) reports the stored key it found through the ruflo MCP tools', r.code === 0 && String(finalMsg).includes(canary), `exit=${r.code} ${Math.round((Date.now() - t0) / 1000)}s attempts=${attempts} final=${String(final).slice(0, 80)}`)
  const okTools = calls.filter(e => !e.item.error).map(e => e.item.tool)
  rec.check('live: Codex made real mcp_tool_call items to the ruflo server for memory_store and memory_search (not just words in the reply)', okTools.includes('memory_store') && okTools.some(t => t.startsWith('memory_search')), `calls: ${calls.map(e => `${e.item.tool}${e.item.error ? '(error)' : ''}`).join(', ') || 'none'}; attempts=${attempts}`)
  const hookErrs = events.filter(e => e.item?.type === 'error' && /hook/i.test(e.item.message ?? '') && !/dangerously-bypass-hook-trust|clamping/.test(e.item.message ?? '')).map(e => e.item.message)
  rec.check('live: the installed ruflo-core@ruflo plugin hooks run under Codex without a hook error (#2716/#2816 class)', hookErrs.length === 0, hookErrs.length ? redact(hookErrs[0]).slice(0, 160) : 'no hook error items in the event stream')
  const fired = existsSync(log) ? [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean))] : []
  rec.check('live: Codex command hooks fire (user-level hooks.json, with --dangerously-bypass-hook-trust in this throwaway home)', fired.length > 0, `fired: ${fired.join(',') || 'none'}; not fired: ${ev.filter(e => !fired.includes(e)).join(',')}`, { firedEvents: fired })
  const after = await usageNow(key)
  const tokens = [...events].reverse().find(e => e.type === 'turn.completed')?.usage
  const est = tokens ? (tokens.input_tokens * 1.0 + tokens.output_tokens * 5.0) / 1e6 : 0.01 // conservative upper bound ($1/$5 per M)
  spend.add(Number.isFinite(before) && Number.isFinite(after) && after - before > 0 ? after - before : est)
  process.env.CODEX_HOME = codexHome
  const { codexRows } = await import(`${REPO}/plugins/ruflo-cost-tracker/scripts/_ledger.mjs`)
  const rows = [...codexRows({ sinceMs: Date.now() - 3_600_000 })]
  delete process.env.CODEX_HOME
  rec.check('live: cost-tracker counts the Codex run (>=1 row with tokens, single owning session)', rows.length >= 1 && rows.some(x => x.input + x.output > 0) && new Set(rows.map(x => x.session)).size === 1, `${rows.length} rows, models=${[...new Set(rows.map(x => x.model))].join(',')}`)

  // Policy probe: can a Codex command hook do what ruflo-mods does on Claude Code? (route -> UserPromptSubmit additionalContext; guard -> PreToolUse deny.)
  const policy = join(sb.home, 'hook-policy.mjs'), plog = join(sb.home, 'policy.log')
  const ctxMark = `CTX-${canary}`, bad = `marker-${canary}`
  writeFileSync(policy, `import{appendFileSync}from'node:fs';let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j={};try{j=JSON.parse(s)}catch{}const e=j.hook_event_name||process.argv[2];appendFileSync(${JSON.stringify(plog)},e+'\\n');
if(e==='UserPromptSubmit'){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'The routing marker for this session is ${ctxMark}.'}}));return}
if(e==='PreToolUse'&&s.includes(${JSON.stringify(bad)})){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'ruflo guard e2e: blocked'}}));return}
process.stdout.write('{}')})\n`)
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${process.execPath} ${policy} UserPromptSubmit`, timeout: 10 }] }], PreToolUse: [{ hooks: [{ type: 'command', command: `${process.execPath} ${policy} PreToolUse`, timeout: 10 }] }] } }))
  const probe2 = `First run the shell command: echo ${bad}. Then reply with two lines: line 1 the routing marker for this session if you were given one (else NONE), line 2 the output of the shell command (else BLOCKED).`
  let ev2, msg2 = '', tries = 0
  do {
    tries++
    const r2 = await run(bin, ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-hook-trust', '-s', 'read-only', probe2], { cwd: proj, env, timeout: 300_000 })
    ev2 = r2.out.split('\n').map(l => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
    msg2 = String([...ev2].reverse().find(e => e.item?.type === 'agent_message')?.item?.text ?? '')
    const t2 = [...ev2].reverse().find(e => e.type === 'turn.completed')?.usage
    spend.add(t2 ? (t2.input_tokens * 1.0 + t2.output_tokens * 5.0) / 1e6 : 0.01)
  } while (!msg2.includes(ctxMark) && tries < 2) // model-dependent: the hook always fires, but a small model may not repeat the marker
  rec.check('live: a Codex UserPromptSubmit hook can inject context the model then uses (ruflo-mods route equivalent)', msg2.includes(ctxMark), `${redact(msg2).replace(/\s+/g, ' ').slice(0, 120)} (tries=${tries}; hook fired=${(existsSync(plog) ? readFileSync(plog, 'utf8') : '').includes('UserPromptSubmit')})`, { equivalent: 'route' })
  const cmd = ev2.filter(e => e.type === 'item.completed' && /command_execution|exec/.test(e.item?.type ?? '')).map(e => e.item)
  const ran = cmd.some(c => String(c.aggregated_output ?? c.output ?? '').includes(bad) && !/block|denied/i.test(JSON.stringify(c)))
  const fired2 = existsSync(plog) ? readFileSync(plog, 'utf8').split('\n').filter(Boolean) : []
  const line2 = msg2.split('\n').slice(1).join(' ')
  if (!fired2.includes('PreToolUse')) rec.flaky('live: a Codex PreToolUse hook can veto a shell tool call (ruflo-mods guard equivalent)', 'the model never attempted the shell call this run, so the hook had nothing to veto; rerun')
  else rec.check('live: a Codex PreToolUse hook can veto a shell tool call (ruflo-mods guard equivalent)', !ran && !line2.includes(bad), `PreToolUse fired=${fired2.includes('PreToolUse')}; reply line 2: ${redact(line2).slice(0, 80)}`, { equivalent: 'guard' })
  rec.skipped('live: PreCompact / SubagentStart / SubagentStop (compactCarry, costHardStop equivalents)', 'no non-interactive way to force a compaction or a subagent spawn in `codex exec`; hook events exist in the binary but were not exercised')

}
