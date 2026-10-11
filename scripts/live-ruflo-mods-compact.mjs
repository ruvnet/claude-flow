#!/usr/bin/env node
// Live canary for ruflo-mods `compactCarry` (ADR-451 item 7): a REAL headless Claude Code session is compacted with /compact and asked
// for a canary swarm id and claim id seeded in .claude-flow state. Isolated HOME/CLAUDE_CONFIG_DIR (throwaway), the mod loaded from this
// checkout with --plugin-dir; a second tiny plugin (--snoop DIR) records what session.compact's `instructions` held.
//   node scripts/live-ruflo-mods-compact.mjs --snoop DIR [--n 3] [--model haiku] [--modes on,off,malformed] [--budget 0.25]
// Auth: copies ONLY the access token (no refresh token, so nothing can rotate the real login) from ~/.claude/.credentials.json into the
// throwaway config, mode 0600, and shreds it at the end. Nothing credential-like is printed. Replies are echoed only as boolean checks.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { randomInt } from 'node:crypto'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const REPO = resolve(new URL('..', import.meta.url).pathname)
const PLUG = `${REPO}/plugins/ruflo-mods`
const SNOOP = arg('snoop') ? resolve(arg('snoop')) : undefined
const N = Number(arg('n', '3')), MODEL = arg('model', 'haiku'), BUDGET = arg('budget', '0.25')
const MODES = arg('modes', 'on,off,malformed').split(',')
const rand = len => { const a = 'abcdefghjkmnpqrstuvwxyz'; return Array.from({ length: len }, () => a[randomInt(a.length)]).join('') }

const HOME = mkdtempSync(join(tmpdir(), 'compact-live-home.'))
const CFG = join(HOME, '.claude')
mkdirSync(CFG, { recursive: true })
const real = JSON.parse(readFileSync(join(homedir(), '.claude/.credentials.json'), 'utf8')).claudeAiOauth
writeFileSync(join(CFG, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: real.accessToken, expiresAt: real.expiresAt, scopes: real.scopes, subscriptionType: real.subscriptionType } }), { mode: 0o600 })
writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, numStartups: 5 }))
const env = { ...process.env, HOME, CLAUDE_CONFIG_DIR: CFG, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1', XDG_CONFIG_HOME: join(HOME, '.config'), XDG_DATA_HOME: join(HOME, '.local/share') }
delete env.ANTHROPIC_API_KEY

function project(mode, swarmId, claimId) {
  const dir = mkdtempSync(join(HOME, `proj-${mode}.`))
  mkdirSync(join(dir, '.claude-flow/swarm'), { recursive: true })
  mkdirSync(join(dir, '.claude-flow/claims'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (mode === 'malformed') {
    writeFileSync(join(dir, '.claude-flow/swarm/swarm-state.json'), '{not json')
    writeFileSync(join(dir, '.claude-flow/claims/claims.json'), '[[[')
  } else {
    writeFileSync(join(dir, '.claude-flow/swarm/swarm-state.json'), JSON.stringify({ version: '3.0.0', swarms: { a: { swarmId, topology: 'hierarchical', status: 'running', agents: ['a1', 'a2', 'a3'], updatedAt: '2026-10-10T00:00:00Z' } } }))
    writeFileSync(join(dir, '.claude-flow/claims/claims.json'), JSON.stringify({ claims: { c: { issueId: claimId, status: 'active', claimant: { type: 'agent' }, progress: 0 } }, stealable: {}, contests: {} }))
  }
  return dir
}

async function session(dir, prompts, enable) {
  const f = join(HOME, `settings-${rand(5)}.json`)
  const o = enable ? { options: { compactCarry: true } } : {}
  writeFileSync(f, JSON.stringify(enable ? { pluginConfigs: { 'ruflo-mods@inline': o, 'ruflo-mods': o } } : {}))
  const denied = 'Bash,Read,Grep,Glob,WebFetch,WebSearch,Edit,Write,NotebookEdit'
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--plugin-dir', PLUG, ...(SNOOP ? ['--plugin-dir', SNOOP] : []),
    '--settings', f, '--setting-sources', 'local', '--max-budget-usd', BUDGET, '--allowedTools', 'ToolSearch', '--disallowedTools', denied,
    '--append-system-prompt', 'Answer exactly as asked, no commentary.']
  const p = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'], env })
  let buf = '', onResult
  const seen = new Set()
  p.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      try { const m = JSON.parse(line); if (m.type === 'system') seen.add(m.subtype); if (m.type === 'result' && onResult) onResult(m) } catch {}
    }
  })
  const rows = []
  for (const text of prompts) {
    const done = new Promise(res => { onResult = res })
    p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    const r = await Promise.race([done, new Promise(res => setTimeout(() => res(undefined), 180_000))])
    rows.push({ reply: String(r?.result ?? '(timeout)'), cost: r?.total_cost_usd, err: r?.is_error })
  }
  p.stdin.end()
  await new Promise(res => { const t = setTimeout(() => (p.kill(), res()), 15_000); p.on('close', () => (clearTimeout(t), res())) })
  return { rows, cost: rows.at(-1)?.cost ?? 0, seen: [...seen] }
}

const ASK = 'From your context alone (no tools), list every swarm id and every claim id that ruflo state recorded for this session. Reply with the ids only, or the word NONE.'
const ASK2 = 'Does your context hold a line or summary note beginning "ruflo state at compaction"? If yes, repeat the swarm and claim ids from it; if not, reply NONE.'
const FILL = ['We are testing a small task. Reply with the word OK.', 'Name one color. One word.']
const results = []
let total = 0
try {
  for (const mode of MODES) for (let i = 1; i <= N; i++) {
    const swarmId = `swarm-${rand(8)}`, claimId = `cl-${rand(6)}`
    const dir = project(mode, swarmId, claimId)
    const s = await session(dir, [...FILL, ASK, '/compact', ASK, ASK2], mode !== 'off')
    total += s.cost
    const summaryHas = (() => { let hit = false; const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl')) for (const l of readFileSync(p, 'utf8').split('\n')) if (l.includes('isCompactSummary') && l.includes(swarmId)) hit = true } }; try { walk(join(CFG, 'projects')) } catch {} return hit })()
    const snoops = readdirSync(dir).filter(n => n.startsWith('.snoop-compact-') && n.endsWith('.json')).sort().map(n => JSON.parse(readFileSync(join(dir, n), 'utf8')))
    const [pre, post] = [s.rows[2].reply, s.rows[4].reply]
    const has = t => ({ swarm: t.includes(swarmId), claim: t.includes(claimId) })
    const r = { mode, i, preCompact: has(pre), postCompact: has(post), summaryHasSwarmId: summaryHas, probeReply: has(s.rows[5].reply), postReplyNone: /^\W*NONE\W*$/i.test(post.trim()), compactReply: s.rows[3].reply.slice(0, 60), errs: s.rows.map(x => x.err).filter(Boolean).length,
      snoop: snoops.map(x => ({ trigger: x.trigger, agentId: x.agentId, messages: x.messages, instructions: x.instructions ? x.instructions.split(swarmId).join('<SWARM>').split(claimId).join('<CLAIM>') : null })), systemSubtypes: s.seen, cost: s.cost }
    results.push(r)
    console.log(JSON.stringify(r))
  }
} finally {
  try { execFileSync('shred', ['-u', join(CFG, '.credentials.json')]) } catch {}
  rmSync(HOME, { recursive: true, force: true })
}
console.log(JSON.stringify({ total_cost_usd: total, runs: results.length }))
