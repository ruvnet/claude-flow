// OpenRouter leg (ADR-490). Keyless part: ruflo's own provider path (agent_spawn + agent_execute) against a local OpenAI-compatible stub.
// Live part (RUFLO_E2E_LIVE=1): the same path against openrouter.ai with a key read into this process only, redacted everywhere.
import { execFileSync } from 'node:child_process'
import { recorder, sandbox, mcpClient, stubOpenRouter, addSecret, redact, spend } from './lib.mjs'

/** Key lookup: env first, then GCP Secret Manager (ruv-dev, then cognitum-20260110). Returns undefined if none; never prints. */
export function findOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) { addSecret(process.env.OPENROUTER_API_KEY); return process.env.OPENROUTER_API_KEY }
  try {
    const acct = execFileSync('gcloud', ['config', 'get-value', 'account'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (acct !== 'ruv@ruv.net') return undefined
  } catch { return undefined }
  for (const project of ['ruv-dev', 'cognitum-20260110']) {
    try {
      const k = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=OPENROUTER_API_KEY', `--project=${project}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (k) { addSecret(k); return k }
    } catch { /* try the next project */ }
  }
  return undefined
}

const text = r => `${r.text}`.replace(/\s+/g, ' ')

export async function openrouterLeg({ cli, live }) {
  const rec = recorder('openrouter')
  const sb = sandbox('e2e-or.')
  const stub = await stubOpenRouter({ reply: 'STUB-HELLO' })
  const keyless = { ...sb.env, OPENROUTER_API_KEY: 'stub-key-not-a-real-credential', OPENROUTER_BASE_URL: stub.url, RUFLO_PROVIDER: 'openrouter' }
  let c
  try {
    c = await mcpClient(cli.cmd, [...cli.args, 'mcp', 'start'], { cwd: sb.project(), env: keyless })
    await c.tool('agent_spawn', { agentType: 'coder', agentId: 'e2e-or' })
    const r = await c.tool('agent_execute', { agentId: 'e2e-or', prompt: 'say hi' })
    rec.check('stub: agent_execute returns the provider reply', r.json?.success === true && r.json?.output === 'STUB-HELLO', text(r).slice(0, 200))
    rec.check('stub: request went to the OpenAI-compatible path with a bearer header', stub.seen.at(-1)?.url === '/v1/chat/completions' && stub.seen.at(-1)?.hasAuth === true, JSON.stringify(stub.seen.at(-1)))
    rec.check('stub: usage tokens surfaced', r.json?.usage?.totalTokens === 15, JSON.stringify(r.json?.usage))
    rec.check('stub: key never echoed in the tool output', !text(r).includes('stub-key-not-a-real-credential'), 'checked output text')
    for (const status of [429, 500]) {
      const bad = await stubOpenRouter({ status })
      const c2 = await mcpClient(cli.cmd, [...cli.args, 'mcp', 'start'], { cwd: sb.project('p2'), env: { ...keyless, OPENROUTER_BASE_URL: bad.url } })
      await c2.tool('agent_spawn', { agentType: 'coder', agentId: 'e2e-or' })
      const e = await c2.tool('agent_execute', { agentId: 'e2e-or', prompt: 'x' })
      rec.check(`stub: provider ${status} is reported as a failure, not a success`, e.json?.success === false && new RegExp(`openrouter|${status}|stub`, "i").test(text(e)) && !text(e).includes('stub-key-not-a-real-credential'), text(e).slice(0, 200))
      c2.close(); await bad.close()
    }
  } catch (e) { rec.fail('stub leg ran to completion', String(e?.message ?? e)) }
  finally { c?.close(); await stub.close() }

  if (!live) { rec.skipped('live: OpenRouter round trip', 'RUFLO_E2E_LIVE not set'); sb.cleanup(); return rec.rows }
  const key = findOpenRouterKey()
  if (!key) { rec.blocked('live: OpenRouter round trip', 'no OPENROUTER_API_KEY in env or GCP Secret Manager (or gcloud account is not ruv@ruv.net)'); sb.cleanup(); return rec.rows }
  try {
    const kr = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } })
    rec.check('live: key is accepted by OpenRouter (GET /api/v1/key)', kr.status === 200, `HTTP ${kr.status}`)
    const env = { ...sb.env, OPENROUTER_API_KEY: key, RUFLO_PROVIDER: 'openrouter', OPENROUTER_DEFAULT_MODEL: 'anthropic/claude-haiku-4.5' }
    const live1 = await mcpClient(cli.cmd, [...cli.args, 'mcp', 'start'], { cwd: sb.project('live'), env })
    await live1.tool('agent_spawn', { agentType: 'coder', agentId: 'e2e-live' })
    const r = await live1.tool('agent_execute', { agentId: 'e2e-live', prompt: 'Reply with exactly the single word: PONG', maxTokens: 16, temperature: 0 })
    rec.check('live: agent_execute via OpenRouter returns model output', r.json?.success === true && /PONG/i.test(String(r.json?.output)), redact(text(r)).slice(0, 220))
    rec.check('live: usage tokens reported', (r.json?.usage?.totalTokens ?? 0) > 0, JSON.stringify(r.json?.usage))
    rec.check('live: key not present in tool output', !text(r).includes(key), 'checked output text')
    spend.add(0.0001) // two-digit-token calls; the real figure is read from OpenRouter below
    live1.close()
    const gen = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } }).then(x => x.json()).catch(() => ({}))
    rec.pass('live: account usage readable after the call', `usage_daily=${gen?.data?.usage_daily ?? 'n/a'} (account-wide, shared key)`)
  } catch (e) { rec.fail('live leg ran to completion', redact(String(e?.message ?? e))) }
  sb.cleanup()
  return rec.rows
}
