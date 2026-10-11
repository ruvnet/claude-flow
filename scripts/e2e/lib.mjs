// Shared helpers for the three-host e2e loop (ADR-490). No dependencies. Nothing here prints a credential: every string that reaches the
// report goes through redact(), which knows the secret VALUES this process loaded plus common token shapes.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const secrets = new Set()
export const addSecret = v => { if (typeof v === 'string' && v.length >= 8) secrets.add(v) }
const SHAPES = [/(?<![A-Za-z0-9])sk-or-v1-[A-Za-z0-9_-]{8,}/g, /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{8,}/g, /(?<![A-Za-z0-9-])sk-[A-Za-z0-9_-]{20,}/g, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, /("?(?:access_token|refresh_token|id_token|api[_-]?key|authorization)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi]
export function redact(s) {
  let out = String(s ?? '')
  for (const v of secrets) out = out.split(v).join('[REDACTED]')
  for (const re of SHAPES) out = out.replace(re, (m, p) => (typeof p === 'string' ? `${p}[REDACTED]` : '[REDACTED]'))
  return out
}

/** Assertion recorder: status is pass | fail | blocked | skipped | flaky. Evidence is redacted and capped. */
export function recorder(leg) {
  const rows = []
  const add = (status, name, evidence = '', extra = {}) => {
    rows.push({ leg, name, status, evidence: redact(evidence).slice(0, extra.long ? 3000 : 600), ...extra })
    return status === 'pass'
  }
  return {
    rows,
    pass: (name, ev, x) => add('pass', name, ev, x),
    fail: (name, ev, x) => add('fail', name, ev, x),
    blocked: (name, why) => add('blocked', name, why),
    skipped: (name, why) => add('skipped', name, why),
    flaky: (name, why) => add('flaky', name, why),
    check: (name, ok, ev, x) => add(ok ? 'pass' : x?.advisory ? 'advisory' : 'fail', name, ev, x),
  }
}

export const spend = { usd: 0, cap: 6, add(n) { this.usd += Number(n) || 0 }, left() { return this.cap - this.usd } }

export function sandbox(prefix = 'ruflo-e2e.') {
  const home = mkdtempSync(join(tmpdir(), prefix))
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
    RUFLO_NO_SKILLS_SH: '1', CI: process.env.CI ?? '', npm_config_update_notifier: 'false', npm_config_cache: process.env.npm_config_cache ?? join(process.env.HOME ?? home, '.npm'),
  }
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[k]
  const project = (name = 'proj') => { const d = join(home, name); mkdirSync(d, { recursive: true }); return d }
  return { home, env, project, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

/** Run a command, capture stdout+stderr, hard timeout. Never throws. */
export function run(cmd, args, { cwd, env, timeout = 120_000, input } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', done = false
    const t = setTimeout(() => { if (!done) p.kill('SIGKILL') }, timeout)
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('close', (code, sig) => { done = true; clearTimeout(t); resolve({ code, sig, out, err, timedOut: sig === 'SIGKILL' }) })
    p.on('error', e => { done = true; clearTimeout(t); resolve({ code: -1, out, err: String(e), timedOut: false }) })
    if (input != null) p.stdin.write(input)
    p.stdin.end()
  })
}

/** Minimal MCP stdio client (newline-delimited JSON-RPC), as Claude Code and Codex both speak it. */
export async function mcpClient(cmd, args, { cwd, env, timeout = 90_000 } = {}) {
  const p = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = '', stderr = '', n = 0
  const waiters = new Map()
  p.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1)
      try { const m = JSON.parse(l); if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } } catch { /* log line */ }
    }
  })
  p.stderr.on('data', d => { stderr += d })
  const call = (method, params) => new Promise(res => {
    const id = ++n
    waiters.set(id, res)
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => { if (waiters.delete(id)) res({ error: { message: `timeout after ${timeout}ms: ${method}` } }) }, timeout)
  })
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ruflo-e2e', version: '1' } })
  p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  return {
    init, stderr: () => stderr,
    tools: async () => (await call('tools/list', {})).result?.tools ?? [],
    tool: async (name, args = {}) => {
      const r = await call('tools/call', { name, arguments: args })
      const text = r.result?.content?.map(c => c.text).join('') ?? ''
      let json; try { json = JSON.parse(text) } catch { /* plain text */ }
      return { raw: r, text, json, isError: !!r.result?.isError || !!r.error }
    },
    rpc: call, close: () => p.kill('SIGKILL'),
  }
}

/** Local OpenAI-compatible stub (what OpenRouter speaks). Records requests (auth header value is dropped, only its presence kept). */
export async function stubOpenRouter({ reply = 'STUB-OK', status = 200, usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, cost: 0.000042 } } = {}) {
  const seen = []
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      let j; try { j = JSON.parse(body) } catch { /* not json */ }
      seen.push({ method: req.method, url: req.url, hasAuth: /^Bearer\s+\S+/.test(req.headers.authorization ?? ''), model: j?.model, messages: j?.messages?.length, stream: !!j?.stream })
      res.setHeader('content-type', 'application/json')
      if (status !== 200) { res.statusCode = status; return res.end(JSON.stringify({ error: { message: `stub ${status}`, code: status } })) }
      res.end(JSON.stringify({ id: 'gen-stub-1', model: j?.model ?? 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply } }], usage }))
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise(r => srv.close(r)) }
}

export const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return undefined } }
export { existsSync, join, writeFileSync, mkdirSync }

export function renderTable(rows) {
  const icon = { pass: 'PASS', fail: 'FAIL', blocked: 'BLOCKED', skipped: 'skip', flaky: 'FLAKY', advisory: 'ADVISORY' }
  const w = Math.max(...rows.map(r => r.name.length), 10)
  return rows.map(r => `${(icon[r.status] ?? r.status).padEnd(8)} ${r.leg.padEnd(10)} ${r.name.padEnd(w)}  ${r.evidence.split('\n')[0].slice(0, 110)}`).join('\n')
}
