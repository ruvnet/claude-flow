// Claude Code leg (ADR-490). Keyless: init, mods doctor, the generated hook commands, the MCP server round trip.
// Live (RUFLO_E2E_LIVE=1): a real headless `claude -p` (haiku) in an isolated HOME/CLAUDE_CONFIG_DIR with the mods loaded from this checkout.
// Auth: ONLY the access token is copied into the throwaway config (no refresh token, so the real login cannot rotate); shredded at the end.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { recorder, sandbox, run, mcpClient, spend, redact, addSecret, readJson } from './lib.mjs'

const REPO = resolve(new URL('../..', import.meta.url).pathname)
const CANARY = `e2ecanary${Math.random().toString(36).slice(2, 8)}`

export async function claudeLeg({ cli, live }) {
  const rec = recorder('claude')
  const sb = sandbox('e2e-claude.')
  const proj = sb.project('proj')
  await run('git', ['init', '-q'], { cwd: proj, env: sb.env })
  try {
    const init = await run(cli.cmd, [...cli.args, 'init', '--no-plugin-install', '--no-signup', '--no-global'], { cwd: proj, env: sb.env, timeout: 240_000 })
    const settings = readJson(join(proj, '.claude/settings.json'))
    rec.check('init: exits 0 and writes .claude/settings.json + .mcp.json', init.code === 0 && !!settings && existsSync(join(proj, '.mcp.json')), `exit=${init.code} ${init.err.slice(-160)}`)
    const events = Object.keys(settings?.hooks ?? {})
    rec.check('init: lifecycle hooks registered (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart)', ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart'].every(e => events.includes(e)), events.join(','))
    const cmds = Object.values(settings?.hooks ?? {}).flat().flatMap(g => g.hooks ?? []).map(h => h.command ?? '')
    rec.check('init: no hook command goes through `cmd /c` on this platform (#4045)', process.platform === 'win32' || !cmds.some(c => /\bcmd\s+\/c\b/i.test(c)), `${cmds.length} hook commands`)

    const doctor = await run(cli.cmd, [...cli.args, 'mods', 'doctor'], { cwd: proj, env: sb.env, timeout: 120_000 })
    rec.check('mods doctor: exits 0 and reports ruflo-mods enabled + the classic handshake', doctor.code === 0 && /ruflo-mods plugin: enabled/.test(doctor.out) && /classic handshake/.test(doctor.out), doctor.out.split('\n').slice(0, 2).join(' | '))
    rec.check('mods doctor: says plainly when the marketplace is not cloned (headless -p does not clone it)', /not cloned|loads once Claude Code has cloned/.test(doctor.out), (doctor.out.match(/!.*marketplace.*/) ?? [''])[0])

    const pre = settings?.hooks?.PreToolUse?.find(g => g.matcher === 'Bash')?.hooks?.[0]
    if (pre?.command) {
      const t0 = Date.now()
      const hook = await run('sh', ['-c', pre.command], { cwd: proj, env: { ...sb.env, CLAUDE_PROJECT_DIR: proj }, input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi >out.txt' }, session_id: 'e2e' }), timeout: 20_000 })
      rec.check('hooks: the generated PreToolUse(Bash) command runs, exits 0 within its declared timeout', hook.code === 0 && Date.now() - t0 < (pre.timeout ?? 5000) + 3000, `exit=${hook.code} ${Date.now() - t0}ms timeout=${pre.timeout}`)
      rec.check('hooks: stdin JSON text is not executed or redirected into files (#4045 class)', !existsSync(join(proj, 'out.txt')) && !readdirSync(proj).some(f => /^cnt\.set|^MAX_/.test(f)), 'no stray files')
    } else rec.fail('hooks: PreToolUse(Bash) command present', 'not found in settings.json')

    const c = await mcpClient(cli.cmd, [...cli.args, 'mcp', 'start'], { cwd: proj, env: sb.env })
    try {
      const tools = await c.tools()
      rec.check('mcp: tools/list answers with the ruflo surface (>= 100 tools)', tools.length >= 100, `${tools.length} tools`)
      const caps = c.init.result?.capabilities ?? {}
      const rl = caps.resources ? await c.rpc('resources/list', {}) : { result: {} }
      rec.check('mcp: every capability initialize advertises is served (resources/list answers instead of -32601; Codex asks for it first)', !caps.resources || (!rl.error && Array.isArray(rl.result?.resources)), `advertised=${JSON.stringify(caps)} resources/list=${rl.error ? `error ${rl.error.code}` : 'ok'}`)
      const st = await c.tool('memory_store', { key: `k-${CANARY}`, value: `value-${CANARY}`, namespace: 'e2e' })
      const se = await c.tool('memory_search', { query: `value-${CANARY}`, namespace: 'e2e' })
      rec.check('mcp: memory_store then memory_search round trip finds the stored value', st.json?.success === true && (se.json?.results ?? []).some(r => r.key === `k-${CANARY}`), `stored=${st.json?.stored} hits=${se.json?.total}`)
      const tc = await c.tool('task_create', { type: 'feature', description: `e2e ${CANARY}` })
      const tl = await c.tool('task_list', {})
      rec.check('mcp: task_create then task_list shows the task', !!tc.json?.taskId && tl.text.includes(tc.json.taskId), `taskId=${tc.json?.taskId}`)
      await c.tool('task_assign', { taskId: tc.json?.taskId, agentIds: ['__proto__'] })
      const after = await c.tool('memory_search', { query: `value-${CANARY}`, namespace: 'e2e' })
      rec.check('mcp: a prototype-named agent id in task_assign leaves the server serving (#3967; pollution itself is covered by the unit test)', after.json?.total >= 1 && !after.isError, `memory_search hits=${after.json?.total}`)
    } finally { c.close() }
  } catch (e) { rec.fail('keyless leg ran to completion', redact(String(e?.stack ?? e)).slice(0, 300)) }

  if (!live) { rec.skipped('live: headless claude -p session with mods + MCP + hooks', 'RUFLO_E2E_LIVE not set'); sb.cleanup(); return rec.rows }
  await liveClaude({ cli, rec, sb, proj })
  sb.cleanup()
  return rec.rows
}

function claudeSession({ env, cwd, args, prompts, timeout = 240_000 }) {
  return new Promise(async resolveSession => {
    const p = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = '', err = '', onResult
    const events = []
    p.stderr.on('data', d => { err += d })
    p.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        try { const m = JSON.parse(line); events.push(m); if (m.type === 'result' && onResult) onResult(m) } catch { /* not json */ }
      }
    })
    const results = []
    for (const text of prompts) {
      const done = new Promise(r => { onResult = r })
      p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
      results.push(await Promise.race([done, new Promise(r => setTimeout(() => r({ result: '(timeout)', is_error: true }), timeout))]))
    }
    p.stdin.end()
    await new Promise(r => { const t = setTimeout(() => (p.kill('SIGKILL'), r()), 15_000); p.on('close', () => (clearTimeout(t), r())) })
    resolveSession({ results, events, err })
  })
}

async function liveClaude({ cli, rec, sb, proj }) {
  const cfg = join(sb.home, '.claude')
  mkdirSync(cfg, { recursive: true })
  let tokenOk = false
  try {
    const real = JSON.parse(readFileSync(join(homedir(), '.claude/.credentials.json'), 'utf8')).claudeAiOauth
    addSecret(real.accessToken)
    writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: real.accessToken, expiresAt: real.expiresAt, scopes: real.scopes, subscriptionType: real.subscriptionType } }), { mode: 0o600 })
    chmodSync(join(cfg, '.credentials.json'), 0o600)
    tokenOk = Date.now() < Number(real.expiresAt)
  } catch { /* handled below */ }
  if (!tokenOk) return rec.blocked('live: headless claude -p session', 'no unexpired Claude access token in ~/.claude/.credentials.json')
  writeFileSync(join(sb.home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, numStartups: 5 }))
  const env = { ...sb.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' }
  const mcp = JSON.stringify({ mcpServers: { ruflo: { command: cli.cmd, args: [...cli.args, 'mcp', 'start'], env: { RUFLO_NO_SKILLS_SH: '1' } } } })
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-budget-usd', '0.6',
    '--plugin-dir', join(REPO, 'plugins/ruflo-mods'), '--plugin-dir', join(REPO, 'plugins/ruflo-console'), '--mcp-config', mcp, '--strict-mcp-config', '--setting-sources', 'project,local',
    '--append-system-prompt', 'Answer exactly as asked. No commentary.']

  // L1: MCP tools + classic hooks + the ledger, one session.
  const s1 = await claudeSession({ env, cwd: proj, args: [...base, '--allowedTools', 'mcp__ruflo__memory_store,mcp__ruflo__memory_search', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Task'],
    prompts: [`Call mcp__ruflo__memory_store with key "live-${CANARY}", value "live-value-${CANARY}", namespace "e2elive". Then call mcp__ruflo__memory_search with query "live-value-${CANARY}" and namespace "e2elive". Reply with the key you found, or NOT_FOUND.`] })
  const r1 = s1.results[0]
  spend.add(r1?.total_cost_usd)
  rec.check('live: haiku calls the ruflo MCP tools and finds the stored value', !r1?.is_error && String(r1?.result).includes(`live-${CANARY}`), redact(String(r1?.result)).slice(0, 160), { costUsd: r1?.total_cost_usd })
  const tooluses = s1.events.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(b => b.type === 'tool_use').map(b => b.name)
  rec.check('live: both tool calls went through the ruflo server', tooluses.includes('mcp__ruflo__memory_store') && tooluses.includes('mcp__ruflo__memory_search'), tooluses.join(','))
  const sys = s1.events.find(e => e.type === 'system' && e.subtype === 'init')
  rec.check('live: ruflo-mods and ruflo-console are loaded from this checkout', JSON.stringify(sys?.plugins ?? []).includes('ruflo-mods') && JSON.stringify(sys?.plugins ?? []).includes('ruflo-console'), JSON.stringify((sys?.plugins ?? []).map(p => p.name ?? p)).slice(0, 160))
  const hookEv = s1.events.filter(e => e.type === 'system' && /hook/.test(String(e.subtype)))
  rec.check('live: Claude Code ran the project hooks (hook_started/hook_response events)', hookEv.length > 0, `${hookEv.length} hook events: ${[...new Set(hookEv.map(e => e.subtype))].join(',')}`)

  // L2: cost ledger sees the run (cost-tracker's own reader, pointed at the throwaway config).
  process.env.CLAUDE_CONFIG_DIR = cfg
  const { claudeRows } = await import(`${REPO}/plugins/ruflo-cost-tracker/scripts/_ledger.mjs`)
  const rows = [...claudeRows({ sinceMs: Date.now() - 3_600_000 })]
  delete process.env.CLAUDE_CONFIG_DIR
  rec.check('live: cost-tracker ledger counts the session (>=1 assistant row, tokens > 0)', rows.length >= 1 && rows.reduce((a, r) => a + r.input + r.output + r.cache_read, 0) > 0, `${rows.length} rows, models=${[...new Set(rows.map(r => r.model))].join(',')}`)

  // L3: console_state model-facing sanity + costHardStop (needs 2 turns: the first crosses the tiny budget, the second tries to spawn a subagent).
  const optsFile = join(sb.home, 'mods-settings.json')
  const o = { options: { costBudgetUsd: 0.00005, costHardStop: true } }
  writeFileSync(optsFile, JSON.stringify({ pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } }))
  const s2 = await claudeSession({ env, cwd: proj, args: [...base, '--settings', optsFile, '--allowedTools', 'mcp__ruflo-console__console_state,Task,Agent', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch'],
    prompts: ['Call mcp__ruflo-console__console_state once and reply with the first 60 characters of what it returned.', 'Now use the Task (Agent) tool to spawn one subagent that replies with the word hi. Report exactly what happened, including any refusal text.'] })
  s2.results.forEach(r => spend.add(r?.total_cost_usd))
  const consoleOut = s2.events.filter(e => e.type === 'user').flatMap(e => e.message?.content ?? []).filter(b => b.type === 'tool_result').map(b => JSON.stringify(b.content)).join('\n')
  rec.check('live: console_state is model-safe (no ESC/OSC bytes, no other project paths, bounded)', consoleOut.length > 0 && !/\\u001b|\\x1b|\\u009b/i.test(consoleOut) && !consoleOut.includes(homedir()) && consoleOut.length < 20_000, `${consoleOut.length} chars`)
  const toolResults2 = s2.events.filter(e => e.type === 'user').flatMap(e => e.message?.content ?? []).filter(b => b.type === 'tool_result' && b.is_error !== undefined || b.type === 'tool_result').map(b => JSON.stringify(b.content)).join('\n')
  const denied = /new agents are halted|costHardStop/i.test(toolResults2)
  rec.check('live: costHardStop refuses the new subagent past the budget (the deny text is in the tool_result, not just the model\'s words)', denied, redact(toolResults2.split('\n').find(l => /halted|costHardStop|denied/i.test(l)) ?? toolResults2).slice(0, 200))
}
