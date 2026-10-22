/**
 * The standalone Node host with the AI doors open (ADR-489 phase 3): the pinned Codex only (a fake one here), HTTPS to a listed host only
 * (an injected fetch), a model key read by NAME. Nothing reaches the real network or a real Codex.
 *   npx vitest run plugins/ruflo-console/tests/tui-ai-host.spec.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createNodeHost, resolveCodex } from '../tui/node-host'

const FAKE = join(__dirname, 'fixtures', 'fake-codex.mjs')
const isWin = process.platform === 'win32'
const NEW = ['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-']
let root: string
let codexHome: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-ai-host-'))
  codexHome = join(root, 'codex-home')
  mkdirSync(join(root, 'project'), { recursive: true })
  mkdirSync(codexHome, { recursive: true })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const host = (ai: Parameters<typeof createNodeHost>[0]['ai'] = { codexBin: FAKE, allowedHosts: ['openrouter.ai'], keyEnvs: ['OPENROUTER_API_KEY'] }) => createNodeHost({ cwd: join(root, 'project'), home: root, ai })

async function drain(stream: ReturnType<ReturnType<typeof host>['spawn']>): Promise<{ out: string; err: string; code: number | null }> {
  let out = ''
  let err = ''

  for await (const chunk of stream) {
    if (chunk.stream === 'stdout') out += chunk.text
    else err += chunk.text
  }

  return { out, err, code: (await stream.result).code }
}

describe('the pinned Codex', () => {
  it.skipIf(isWin)('resolves only a program whose --version says exactly the pinned version', async () => {
    expect(await resolveCodex(root, FAKE)).toEqual({ ok: true, bin: FAKE })

    const newer = join(root, 'newer-codex.mjs')

    writeFileSync(newer, '#!/usr/bin/env node\nconsole.log("codex-cli 0.162.1")\n')
    chmodSync(newer, 0o755)
    expect(await resolveCodex(root, newer)).toMatchObject({ ok: false, why: expect.stringMatching(/pinned Codex 0\.162\.0 is not installed/) })
  })

  // Each release case has a home of its own: the next one writes the pinned release, and in a shuffled run it could go first.
  it('finds the release directory named for the pinned version, never current and never PATH', async () => {
    const home = mkdtempSync(join(root, 'home-'))
    const releases = join(home, '.codex', 'packages', 'standalone', 'releases')

    mkdirSync(join(releases, '0.162.1-x86_64-unknown-linux-musl', 'bin'), { recursive: true })
    mkdirSync(join(home, '.codex', 'packages', 'standalone', 'current'), { recursive: true })
    // Another version on disk, and a codex on PATH that claims the pinned version: neither is used.
    writeFileSync(join(releases, '0.162.1-x86_64-unknown-linux-musl', 'bin', 'codex'), '#!/bin/sh\necho "codex-cli 0.162.0"\n')
    chmodSync(join(releases, '0.162.1-x86_64-unknown-linux-musl', 'bin', 'codex'), 0o755)
    expect(await resolveCodex(home)).toMatchObject({ ok: false, why: expect.stringMatching(/never uses current or PATH/) })
  })

  it.skipIf(isWin)('finds the exact release when it is there', async () => {
    const home = mkdtempSync(join(root, 'home-'))
    const dir = join(home, '.codex', 'packages', 'standalone', 'releases', '0.162.0-x86_64-unknown-linux-musl', 'bin')

    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'codex'), readFileSync(FAKE))
    chmodSync(join(dir, 'codex'), 0o755)
    expect(await resolveCodex(home)).toEqual({ ok: true, bin: join(dir, 'codex') })
  })

  it('spawn refuses anything but a read-only codex exec, before a process starts, and with no AI options at all', () => {
    expect(() => host().spawn(['bash', '-c', 'echo hi'])).toThrow(/only `codex exec` runs here/)
    expect(() => host().spawn(['codex', 'exec', '--sandbox', 'danger-full-access', '-'])).toThrow(/not allowed/)
    expect(() => createNodeHost({ cwd: join(root, 'project'), home: root }).spawn(NEW)).toThrow(/AI page is not enabled/)
  })

  it.skipIf(isWin)('streams the child, sends the prompt on stdin, and keeps our API keys out of its environment', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
    process.env.SOME_OTHER_SECRET = 'do-not-leak'
    process.env.CODEX_HOME = codexHome

    try {
      const { out, code } = await drain(host().spawn(NEW, 'hello codex'))
      const ran = JSON.parse(readFileSync(join(codexHome, 'fake-codex.log'), 'utf8').trim().split('\n').pop() as string) as { args: string[]; input: string; codexHome: string | null; hasOpenRouterKey: boolean; hasOtherSecret: boolean }

      expect(code).toBe(0)
      expect(out).toContain('thread.started')
      expect(ran.args).toEqual(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'])
      expect(ran.input).toBe('hello codex')
      expect(ran.codexHome).toBe(codexHome)
      expect(ran.hasOpenRouterKey).toBe(false)
      expect(ran.hasOtherSecret).toBe(false)
    } finally {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.SOME_OTHER_SECRET
      delete process.env.CODEX_HOME
    }
  })

  it('a missing pinned program is a failed start in the stream, with the reason, not a crash', async () => {
    const stream = host({ codexBin: join(root, 'nope', 'codex'), allowedHosts: [], keyEnvs: [] }).spawn(NEW, 'x')

    await expect(drain(stream)).rejects.toThrow(/pinned Codex 0\.162\.0 is not installed/)
  })

  it.skipIf(isWin)('returning from the stream stops the child', async () => {
    const slow = join(root, 'slow-codex.mjs')

    writeFileSync(slow, '#!/usr/bin/env node\nif (process.argv[2] === "--version") { console.log("codex-cli 0.162.0"); process.exit(0) }\nprocess.stdin.resume(); setInterval(() => console.log("tick"), 50)\n')
    chmodSync(slow, 0o755)

    const stream = host({ codexBin: slow, allowedHosts: [], keyEnvs: [] }).spawn(NEW, 'x')
    const first = await stream.next()

    expect(first.done).toBe(false)
    await stream.return(undefined as never)
    await expect(stream.result).resolves.toMatchObject({ signal: 'SIGTERM' })
  })
})

describe('https', () => {
  const sent = () => vi.fn(async (_url: unknown, _init?: unknown) => new Response('{"ok":true}', { status: 200 }))

  it('sends a POST to a listed host with redirects off, and nothing else leaves', async () => {
    const fetchSpy = sent()
    const h = host({ allowedHosts: ['openrouter.ai'], keyEnvs: [], fetch: fetchSpy as never })
    const reply = await h.httpSend!('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: '{}' })

    expect(reply).toEqual({ ok: true, status: 200, text: '{"ok":true}' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0]?.[1] as { redirect: string }).redirect).toBe('manual')

    for (const url of ['http://openrouter.ai/x', 'https://evil.example.com/x', 'https://openrouter.ai.evil.com/x', 'https://169.254.169.254/x']) {
      expect(await h.httpSend!(url, { method: 'POST', headers: {}, body: '{}' })).toMatchObject({ ok: false, status: 0 })
    }
    expect(await h.httpSend!('https://openrouter.ai/x', { method: 'GET', headers: {}, body: '' })).toMatchObject({ ok: false, status: 0 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a redirect is an error, never followed (it could carry the key to another host)', async () => {
    const h = host({ allowedHosts: ['openrouter.ai'], keyEnvs: [], fetch: (async () => new Response('', { status: 302, headers: { location: 'https://evil.example.com/' } })) as never })

    expect(await h.httpSend!('https://openrouter.ai/x', { method: 'POST', headers: {}, body: '{}' })).toMatchObject({ ok: false, status: 302, text: expect.stringMatching(/does not follow redirects/) })
  })

  it('with no AI options the host sends nothing', async () => {
    const fetchSpy = sent()

    expect(await createNodeHost({ cwd: join(root, 'project'), home: root }).httpSend!('https://openrouter.ai/x', { method: 'POST', headers: {}, body: '{}' })).toMatchObject({ ok: false, status: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads a model key by name, only a name it was given, and any other command stays refused', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
    process.env.SOME_OTHER_SECRET = 'do-not-read'

    try {
      const h = host({ allowedHosts: ['openrouter.ai'], keyEnvs: ['OPENROUTER_API_KEY'] })

      expect((await h.run(['printenv', 'OPENROUTER_API_KEY'], 1000)).stdout.trim()).toBe(process.env.OPENROUTER_API_KEY)
      expect((await h.run(['printenv', 'MISSING_KEY_VAR'], 1000).catch(() => ({ exitCode: -1 }))).exitCode).not.toBe(0)
      await expect(h.run(['printenv', 'SOME_OTHER_SECRET'], 1000)).rejects.toThrow(/not available/)
      await expect(h.run(['printenv'], 1000)).rejects.toThrow(/not available/)
      await expect(h.run(['sh', '-c', 'echo $HOME'], 1000)).rejects.toThrow(/not available/)
    } finally {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.SOME_OTHER_SECRET
    }
  })
})
