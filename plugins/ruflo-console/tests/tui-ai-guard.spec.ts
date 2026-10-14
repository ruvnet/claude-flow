/**
 * What the AI page may run and send (ADR-489 decision D): every refusal pinned. Pure, so no process and no network.
 *   npx vitest run plugins/ruflo-console/tests/tui-ai-guard.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { allowedHostsOf, PINNED_CODEX, validateCodexArgv, validateHttp } from '../tui/ai-guard'

const NEW = ['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-']
const RESUME = ['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '019f0000-aaaa-bbbb-cccc-000000000001', '-']

describe('codex argv', () => {
  it('accepts exactly what the console builds for a new thread and for a resumed one, read-only', () => {
    expect(validateCodexArgv(NEW)).toEqual({ ok: true, args: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'], sandbox: 'read-only' })
    expect(validateCodexArgv(RESUME)).toEqual({ ok: true, args: ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '019f0000-aaaa-bbbb-cccc-000000000001', '-'], sandbox: 'read-only' })
    expect(validateCodexArgv(['codex', 'exec', '-s', 'read-only', '--ephemeral', '-m', 'gpt-5-codex', '-'])).toMatchObject({ ok: true })
  })

  it('refuses another program, another subcommand, and a missing explicit sandbox', () => {
    expect(validateCodexArgv(['bash', 'exec', '-'])).toMatchObject({ ok: false })
    expect(validateCodexArgv(['codex', 'login'])).toMatchObject({ ok: false })
    expect(validateCodexArgv(['codex', 'exec', '--json', '-'])).toMatchObject({ ok: false, why: expect.stringMatching(/explicit sandbox/) })
    expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only'])).toMatchObject({ ok: false, why: expect.stringMatching(/must end with -/) })
    expect(validateCodexArgv([...NEW, '--yolo'])).toMatchObject({ ok: false })
  })

  it('refuses danger-full-access and every way to widen the sandbox, whatever the opt-in', () => {
    for (const allow of [false, true]) {
      expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'danger-full-access', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '-c', 'sandbox_mode="danger-full-access"', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', '--sandbox', 'read-only', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '-p', 'unsafe', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '--add-dir', '/', '-'], allow)).toMatchObject({ ok: false })
      expect(validateCodexArgv(['codex', 'exec', '--full-auto', '--sandbox', 'read-only', '-'], allow)).toMatchObject({ ok: false })
    }
  })

  it('allows workspace-write only after the per-session opt-in, and never two different modes', () => {
    const write = ['codex', 'exec', '--sandbox', 'workspace-write', '-']

    expect(validateCodexArgv(write)).toMatchObject({ ok: false })
    expect(validateCodexArgv(write, true)).toMatchObject({ ok: true, sandbox: 'workspace-write' })
    expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '-c', 'sandbox_mode="workspace-write"', '-'], true)).toMatchObject({ ok: false, why: expect.stringMatching(/two different/) })
  })

  it('refuses a model name that is not a plain name, a stray token, and anything after the stdin marker', () => {
    expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '-m', 'a b; rm -rf /', '-'])).toMatchObject({ ok: false })
    expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', 'some prompt text', '-'])).toMatchObject({ ok: false })
    expect(validateCodexArgv(['codex', 'exec', '--sandbox', 'read-only', '-', 'x'])).toMatchObject({ ok: false })
  })

  it('pins the version the tests and the host check against', () => {
    expect(PINNED_CODEX).toBe('0.162.0')
  })
})

const POST = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: '{}' }

describe('http', () => {
  const hosts = ['openrouter.ai', 'llm.example.com']

  it('accepts https POST to a listed host with the two chat headers', () => {
    expect(validateHttp('https://openrouter.ai/api/v1/chat/completions', POST, hosts)).toMatchObject({ ok: true })
    expect(validateHttp('https://llm.example.com:443/v1/chat/completions', POST, hosts)).toMatchObject({ ok: true })
  })

  it('refuses http, other hosts, look-alike hosts, userinfo, other ports, other methods and other headers', () => {
    expect(validateHttp('http://openrouter.ai/x', POST, hosts)).toMatchObject({ ok: false, why: 'https only' })
    expect(validateHttp('https://evil.example.com/x', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://evil.openrouter.ai/x', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://openrouter.ai.evil.com/x', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://openrouter.ai@evil.com/x', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://user:pw@openrouter.ai/x', POST, hosts)).toMatchObject({ ok: false, why: 'no credentials in the URL' })
    expect(validateHttp('https://openrouter.ai:8443/x', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://169.254.169.254/latest', POST, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://openrouter.ai/x', { ...POST, method: 'GET' }, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://openrouter.ai/x', { ...POST, headers: { ...POST.headers, cookie: 'a=b' } }, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('https://openrouter.ai/x', { ...POST, body: 'x'.repeat(100_001) }, hosts)).toMatchObject({ ok: false })
    expect(validateHttp('not a url', POST, hosts)).toMatchObject({ ok: false })
  })

  it('builds the host list from openrouter.ai and the https hosts a convoTargets entry names, never an address or an http host', () => {
    expect(allowedHostsOf(['https://llm.example.com/v1', 'http://plain.example.com/v1', 'https://10.0.0.5/v1', 'https://box.internal/v1', 'https://localhost.local/v1', 'garbage'])).toEqual(['openrouter.ai', 'llm.example.com'])
    expect(allowedHostsOf([])).toEqual(['openrouter.ai'])
  })
})
