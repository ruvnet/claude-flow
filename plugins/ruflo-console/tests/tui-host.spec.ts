/**
 * The standalone Node host (ADR-489): reads stay inside the project, `~/.claude` and `~/.claude-flow` (links resolved first); the only
 * program that runs is the ruflo CLI by argv; everything that needs the Claude Code engine is refused. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-host.spec.ts
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cliArgv, createNodeHost } from '../tui/node-host'

let root: string
let project: string
let home: string
let outside: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tui-host-'))
  project = join(root, 'project')
  home = join(root, 'home')
  outside = join(root, 'outside')
  for (const dir of [join(project, '.claude-flow'), join(home, '.claude'), join(home, '.ssh'), outside]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(project, '.claude-flow', 'a.json'), '{"ok":true}')
  writeFileSync(join(home, '.claude', 'settings.json'), '{}')
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'PRIVATE')
  writeFileSync(join(outside, 'secret.txt'), 'nope')
  symlinkSync(outside, join(project, 'escape'))
  symlinkSync(join(outside, 'secret.txt'), join(project, '.claude-flow', 'link.json'))
  // A CLI stand-in: prints its argv and whether a parent secret reached its environment.
  writeFileSync(join(root, 'cli.mjs'), 'console.log(JSON.stringify({ argv: process.argv.slice(2), leaked: process.env.OPENROUTER_API_KEY ?? null, cwd: process.cwd() }))')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const hostOf = (extra = {}) => createNodeHost({ cwd: project, home, cliEntry: join(root, 'cli.mjs'), ...extra })

describe('reads', () => {
  it('reads inside the project and ~/.claude, relative or absolute', async () => {
    const host = hostOf()

    await expect(host.fs.read('.claude-flow/a.json')).resolves.toBe('{"ok":true}')
    await expect(host.fs.read(join(home, '.claude', 'settings.json'))).resolves.toBe('{}')
    await expect(host.fs.stat('.claude-flow/a.json')).resolves.toMatchObject({ kind: 'file', isLink: false })
    expect((await host.fs.list('.claude-flow')).map(entry => entry.name)).toContain('a.json')
  })

  it('refuses a path outside the roots, a ../ climb and ~/.ssh', async () => {
    const host = hostOf()

    await expect(host.fs.read(join(outside, 'secret.txt'))).rejects.toThrow()
    await expect(host.fs.read('../outside/secret.txt')).rejects.toThrow()
    await expect(host.fs.read(join(home, '.ssh', 'id_ed25519'))).rejects.toThrow()
    await expect(host.fs.list('/')).rejects.toThrow()
  })

  it('refuses a symlink that leaves the project, for a file and for a folder', async () => {
    const host = hostOf()

    await expect(host.fs.read('escape/secret.txt')).rejects.toThrow()
    await expect(host.fs.read('.claude-flow/link.json')).rejects.toThrow()
    await expect(host.fs.list('escape')).rejects.toThrow()
  })

  it('answers undefined for a stat it may not make', async () => {
    await expect(hostOf().fs.stat(join(outside, 'secret.txt'))).resolves.toBeUndefined()
  })
})

describe('programs', () => {
  it('rewrites a ruflo CLI prefix to this CLI, and nothing else', () => {
    expect(cliArgv(['npx', '--offline', '-y', '@claude-flow/cli@latest', 'hooks', 'model-stats'], '/x/cli.js')).toEqual([process.execPath, '/x/cli.js', 'hooks', 'model-stats'])
    expect(cliArgv(['ruflo', '--version'], '/x/cli.js')).toEqual([process.execPath, '/x/cli.js', '--version'])
    expect(cliArgv(['sh', '-c', 'echo hi'], '/x/cli.js')).toBeNull()
    expect(cliArgv(['claude', 'plugin', 'configure', '--help'], '/x/cli.js')).toBeNull()
    expect(cliArgv(['ruflo', '--version'], undefined)).toBeNull()
  })

  it('runs the CLI with no shell, in the project, without the parent secrets', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-should-not-reach-the-child'
    try {
      const done = await hostOf().run(['ruflo', 'memory', 'stats; echo pwned'], 10_000)
      const seen = JSON.parse(done.stdout) as { argv: string[]; leaked: string | null; cwd: string }

      expect(done.exitCode).toBe(0)
      expect(seen.argv).toEqual(['memory', 'stats; echo pwned'])
      expect(seen.leaked).toBeNull()
      expect(seen.cwd.endsWith('project')).toBe(true)
    } finally {
      delete process.env.OPENROUTER_API_KEY
    }
  })

  it('refuses any other program, and every run when no CLI entry is known', async () => {
    await expect(hostOf().run(['sh', '-c', 'echo hi'], 1000)).rejects.toThrow(/not available in the standalone terminal/)
    await expect(createNodeHost({ cwd: project, home }).run(['ruflo', '--version'], 1000)).rejects.toThrow()
  })
})

describe('the Claude Code engine is refused, not faked', () => {
  it('rejects panes, dialogs, network, the prompt box, slash commands and ruflo-mods; spawn throws', async () => {
    const host = hostOf()

    for (const refused of [host.fetchText('https://example.com'), host.askChoice('ok?', ['yes']), host.openPane({} as never), host.panes(), host.settings(), host.rufloSnapshot(), host.submitPrompt('hi'), host.runSlash('x', '')]) await expect(refused).rejects.toThrow(/not available in the standalone terminal/)
    expect(() => host.spawn(['ruflo'])).toThrow()
    expect(host.toolCall).toBeUndefined()
    // httpSend exists for the AI page but sends nothing unless the host was built with the AI options (host tests in tui-ai-host.spec.ts).
    await expect(host.httpSend!('https://openrouter.ai/x', { method: 'POST', headers: {}, body: '{}' })).resolves.toMatchObject({ ok: false, status: 0 })
    await expect(host.fillPrompt('x')).resolves.toBe(false)
  })

  it('keeps the small store in memory only', async () => {
    const host = hostOf()

    await host.storeSet('k', { v: 1 })
    await expect(host.storeGet('k')).resolves.toEqual({ v: 1 })
    await expect(hostOf().storeGet('k')).resolves.toBeUndefined()
  })
})
