/**
 * The OpenAI-compatible send against a REAL local HTTP server (ADR-471): the exact bytes the confirm card showed are the bytes the server received,
 * the key comes from the named environment variable (a test-only string, never printed), and a provider that echoes it has it masked. The
 * transport functions are real (node fetch, a real `printenv`); only the engine is absent. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-send-stub.spec.ts
 */
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { chatBody, payloadOf, sendTo, type SendDeps } from '../hooks/data/wf-send'
import { isBaseUrl, parseConfig, targetsOf, type Target } from '../hooks/data/wf-targets'

const KEY = 'stubkey-9d41-test-only'
const seen: { method?: string; url?: string; authorization?: string; contentType?: string; body: string }[] = []
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''

    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      seen.push({ ...(req.method !== undefined && { method: req.method }), ...(req.url !== undefined && { url: req.url }), ...(req.headers.authorization !== undefined && { authorization: req.headers.authorization }), ...(typeof req.headers['content-type'] === 'string' && { contentType: req.headers['content-type'] }), body })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ model: 'stub-model', choices: [{ message: { content: `stub says hi; echo ${req.headers.authorization ?? 'no-auth'}` } }], usage: { prompt_tokens: 7, completion_tokens: 5, cost: 0.00012 } }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  process.env.STUB_MODEL_KEY = KEY
})

afterAll(() => {
  delete process.env.STUB_MODEL_KEY
  server.close()
})

const run: SendDeps['run'] = (argv, timeoutMs, stdin) =>
  new Promise(resolve => {
    const child = execFile(argv[0] as string, argv.slice(1), { timeout: timeoutMs }, (error, stdout, stderr) => resolve({ exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }))

    if (stdin !== undefined) child.stdin?.end(stdin)
  })

const depsOf = (config: string): SendDeps => ({
  cli: [], helper: '', trustedPeers: new Set(), cwd: '/tmp', hive: null, config: parseConfig(config), run,
  httpSend: async (url, init) => {
    const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body })

    return { ok: response.ok, status: response.status, text: await response.text() }
  },
  submitPrompt: async () => undefined,
})
const targetOf = (d: SendDeps, id: string): Target => targetsOf({ agents: [], peers: [], config: d.config, hasHive: false, hasCodex: false }).find(target => target.id === id) as Target

describe('the stub endpoint receives exactly what the card showed', () => {
  it('the request body is the one on the card, the key rides one header, and the echoed key is masked in the answer', async () => {
    const d = depsOf(`endpoint:stub=${base}|STUB_MODEL_KEY|stub-model`)
    const target = targetOf(d, 'stub')
    const card = payloadOf(target, 'compare raft and paxos', d)

    expect(card.ok).toBe(true)

    const answered = await sendTo(d, target, 'compare raft and paxos')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions', contentType: 'application/json', authorization: `Bearer ${KEY}` })
    expect(seen[0]?.body).toBe(chatBody({ name: 'stub', baseUrl: base, keyEnv: 'STUB_MODEL_KEY', model: 'stub-model' }, 'compare raft and paxos'))
    expect(card.ok && card.payload.shows).toContain(seen[0]?.body)
    expect(card.ok && card.payload.shows).toContain('Authorization: Bearer ‹from $STUB_MODEL_KEY›')
    expect(card.ok && card.payload.shows).not.toContain(KEY)
    expect(answered).toMatchObject({ ok: true, state: 'reply', tokensIn: 7, tokensOut: 5, costUsd: 0.00012, model: 'stub-model' })
    expect(answered.text).toContain('stub says hi; echo ‹masked›')
    expect(answered.text).not.toContain(KEY)
  })

  it('with the key variable unset nothing reaches the server', async () => {
    const before = seen.length
    const d = depsOf(`endpoint:stub2=${base}|STUB_UNSET_KEY_VAR|stub-model`)

    expect(await sendTo(d, targetOf(d, 'stub2'), 'hi')).toMatchObject({ ok: false, state: 'refused' })
    expect(seen).toHaveLength(before)
  })

  it('with NONE as the key name no Authorization header is sent', async () => {
    const d = depsOf(`endpoint:open=${base}|NONE|stub-model`)

    await sendTo(d, targetOf(d, 'open'), 'hi')
    expect(seen.at(-1)?.authorization).toBeUndefined()
  })
})

describe('the SSRF rules still hold (the engine itself does not refuse a link-local address: it waits 30 s, ADR-471)', () => {
  it.each(['http://169.254.169.254/latest', 'https://169.254.169.254/v1', 'http://0.0.0.0:8080/v1', 'http://[::ffff:169.254.169.254]/v1', 'https://metadata.google.internal/v1', 'http://instance-data/v1', 'http://224.0.0.1/v1', 'http://evil.example.com/v1', 'https://user:pass@x.example.com/v1', 'https://x.example.com/v1?key=1', 'file:///etc/passwd', 'ftp://x.example.com/v1'])('refuses %s', url => {
    expect(isBaseUrl(url)).toBe(false)
    expect(parseConfig(`endpoint:x=${url}|KEY|m`).endpoints).toEqual([])
  })

  it('allows this machine, a tailnet address and https hosts', () => {
    for (const url of ['http://127.0.0.1:18765/v1', 'http://localhost:11434/v1', 'http://100.104.125.72:11434/v1', 'https://openrouter.ai/api/v1']) expect(isBaseUrl(url)).toBe(true)
  })
})
