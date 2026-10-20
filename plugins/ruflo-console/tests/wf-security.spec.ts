/**
 * Security audit of the Workflows board (ADR-464 follow-up): what must never reach a cell, a log line, an export, a notice or a saved
 * file, where a write may land, what an argv may carry, and that hostile JSON cannot pollute a prototype. Real files and real `dd`
 * where the property is about the disk; no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-security.spec.ts --testTimeout=30000
 */
import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, open, readFile, rm, stat as statOf, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodeSaved, encodeSaved, emptySaved, setFilter } from '../hooks/data/wf-saved'
import { cleanBlock, cleanPath } from '../hooks/data/wf-activity'
import { cleanText } from '../hooks/data/wf-clean'
import { checkNoLinks, newFileArgv, resolveExportPath } from '../hooks/data/wf-file'
import { posixCreateExclusive, writeFlavorReady } from '../hooks/data/write-flavor'
import { useNativeWriteFlavor } from './fixtures/write-flavor'
import { exportName, exportSpec, runMarkdown } from '../hooks/data/wf-export'
import { maskSecrets, parseAgentMeta, parseJournal } from '../hooks/data/workflows'
import { guardText } from '../hooks/data/wf-guide'
import { newState } from '../hooks/state'
import { resetSavedLive, savedFor, savedPathOf, syncSavedViews, updateSaved } from '../hooks/wf-saved-live'
import { setSearch } from '../hooks/data/wf-saved'
import { BASE, runOf } from './fixtures/wf-runs'

const ESC = '\u001b'
const BEL = '\u0007'

/** Every credential shape the console must not show, each with the secret part that must be gone. */
const SECRETS: [string, string][] = [
  ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'AbCdEfGhIjKlMnOpQr'],
  ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnop'],
  ['glpat-abcdefghij0123456789', 'abcdefghij0123456789'],
  ['npm_abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnop'],
  ['xo' + 'xb-123456789012-abcdefghijklmnop', 'abcdefghijklmnop'],
  ['AKIAIOSFODNN7EXAMPLE', 'IOSFODNN7EXAMPLE'],
  ['Authorization: Bearer abc123def456ghi', 'abc123def456ghi'],
  ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  ['{"password": "hunter2hunter2"}', 'hunter2hunter2'],
  ["{'api_key': 'abcd1234efgh'}", 'abcd1234efgh'],
  ['DATABASE_PASSWORD=correcthorse', 'correcthorse'],
  ['STRIPE_SECRET_KEY=whatever1234', 'whatever1234'],
  ['DB_PASS=letmein99', 'letmein99'],
  ['curl --token tok_123456789 https://x', 'tok_123456789'],
  ['run --password=swordfish1', 'swordfish1'],
  ['postgres://admin:s3cr3tpw@db.example.com/app', 's3cr3tpw'],
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'eyJzdWIiOiIxMjM0NTY3ODkw'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU\n-----END OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjE'],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA', 'MIIEowIBAAKCAQEA'],
]

describe('secrets never survive the wash', () => {
  it.each(SECRETS)('masks %s', (input, secret) => {
    for (const out of [maskSecrets(input), cleanText(`before ${input} after`), cleanBlock(input).text, cleanBlock(`${ESC}[31m${input}${ESC}[0m`).text]) {
      expect(out).not.toContain(secret)
      expect(out).toContain('‹masked›')
    }
  })

  it('masks a credential in a journal result, an agent meta and a run summary export', () => {
    const journal = JSON.stringify({ type: 'result', key: 'k', agentId: 'a1', result: 'done. {"api_key": "zzzz1234yyyy"} and Authorization: Bearer ttt999uuu888' })
    const preview = parseJournal(`${JSON.stringify({ type: 'launched' })}\n${journal}\n`).agents[0]?.resultPreview ?? ''

    expect(preview).not.toMatch(/zzzz1234yyyy|ttt999uuu888/)

    const run = runOf('wf_s', [{ id: 'a', label: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', phase: 'Build', at: 0, ms: 5 }], { workflowName: 'name DB_PASS=letmein99' })
    const md = runMarkdown({ ...run, name: cleanText(run.name) }, { nowMs: 1 })

    expect(md).not.toMatch(/letmein99|ghp_abcdefghij/)
  })

  it('keeps ordinary prose and ids readable (no false-positive storm)', () => {
    for (const fine of ['the build passed in 12 s', 'bypass: the cache', 'agent-3 finished phase Review', 'wf_a1b2c3', '/home/u/projects/ruflo/.claude/worktrees/feat-x']) expect(cleanText(fine)).toBe(fine)
  })

  it('does not take a pathological line hostage (1 MB of each hostile shape in well under a second)', () => {
    const shapes = ['a'.repeat(1_000_000), `${'-----BEGIN PRIVATE KEY-----'.repeat(40_000)}`, 'key='.repeat(250_000), `${'Bearer '.repeat(150_000)}`, `${'x:'.repeat(500_000)}`, 'password"'.repeat(100_000), `${'://a:'.repeat(200_000)}`, ' '.repeat(1_000_000), `--token ${'t '.repeat(300_000)}`]

    for (const shape of shapes) {
      const t0 = performance.now()

      cleanBlock(shape)
      maskSecrets(shape.slice(0, 1_000_000))
      expect(performance.now() - t0).toBeLessThan(1500)
    }
  })
})

describe('terminal injection', () => {
  const HOSTILE = [`${ESC}]0;pwned title${BEL}label`, `${ESC}]8;;https://evil.example/${ESC}\\click${ESC}]8;;${ESC}\\`, `${ESC}[2J${ESC}[H${ESC}[31mred`, '\u009d0;c1 title\u009cx', 'a‮evil‬', 'z​w⁦i⁩x', 'line1\r\nline2\rline3\u0000\u0008', '\u{e0041}tagged']

  it.each(HOSTILE)('strips %j from a cell, a block and a path', input => {
    for (const out of [cleanText(input), cleanBlock(input).text, cleanPath(input)]) {
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩\u{e0000}-\u{e0fff}]/u)
      expect(out).not.toMatch(/pwned|c1 title|evil\.example|\[2J|\[31m/)
    }
  })

  it('strips the same from every string a run file supplies (meta, journal, labels) before a cell sees it', () => {
    const meta = parseAgentMeta(JSON.stringify({ description: `${ESC}]0;t${BEL}d‮`, workflowPhase: 'p​', worktreePath: `/w/‮exe${ESC}[31m`, agentType: 'x' }))

    expect(JSON.stringify(meta)).not.toMatch(/\\u001b|\\u202e|\\u200b|\[31m|\]0;t/)
  })

  it('keeps a very long label to its cap and a binary blob from becoming a cell', () => {
    const meta = parseAgentMeta(JSON.stringify({ description: 'x'.repeat(100_000), worktreePath: 'y'.repeat(100_000) }))

    expect((meta.description ?? '').length).toBeLessThanOrEqual(80)
    expect((meta.worktreePath ?? '').length).toBeLessThanOrEqual(300)
    expect(cleanBlock('\u0000\u0001\u0002binaryÿ\u0000'.repeat(10_000)).text.length).toBeLessThanOrEqual(6000)
  })
})

describe('export and saved-view paths', () => {
  // Real files and the real dd/sh: the argv this machine's tools take (GNU on Linux, the sh scripts on macOS/BSD).
  useNativeWriteFlavor()

  let dir: string
  let outside: string

  const fsOf = {
    stat: async (path: string) => {
      const link = await lstat(path).catch(() => undefined)

      if (link === undefined) return undefined
      if (link.isSymbolicLink()) return { isLink: true, kind: 'symlink', size: link.size, mtimeMs: link.mtimeMs }

      return { isLink: false, kind: link.isDirectory() ? 'dir' : 'file', size: link.size, mtimeMs: link.mtimeMs }
    },
    read: async (path: string) => readFile(path, 'utf8'),
    list: async () => [],
  }
  // stdin goes in as a file descriptor, not a socket: GNU install opens /dev/stdin and refuses a socket (which Node's 'pipe' stdio is).
  const run = async (argv: readonly string[], _ms: number, stdin?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    const input = join(dir, '..', `stdin-${Math.random().toString(36).slice(2)}`)

    await writeFile(input, stdin ?? '')

    const handle = await open(input, 'r')

    return new Promise(resolve => {
      const child = spawn(argv[0] as string, argv.slice(1), { stdio: [handle.fd, 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', chunk => (stdout += chunk))
      child.stderr?.on('data', chunk => (stderr += chunk))
      child.on('close', code => void handle.close().then(() => resolve({ exitCode: code ?? -1, stdout, stderr })))
      child.on('error', error => void handle.close().then(() => resolve({ exitCode: 127, stdout, stderr: String(error) })))
    })
  }

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'wf-sec-'))

    dir = join(base, 'proj')
    outside = join(base, 'outside')
    await mkdir(dir, { recursive: true })
    await mkdir(outside, { recursive: true })
    resetSavedLive()
  })
  afterEach(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true })
  })

  it('refuses every traversal, absolute escape, home, backslash, control and bad-name path', () => {
    const roots = { cwd: dir, scratch: null }

    for (const bad of ['../x.md', 'a/../../x.md', `${outside}/x.md`, '/etc/passwd.md', '~/x.md', 'a\\b.md', 'x\n.md', `x${ESC}[0m.md`, '-rf.md', '.hidden.md', 'x.md.sh', 'x', '', '   ', 'a'.repeat(400), `${dir}-evil/x.md`, `${dir}/../outside/x.md`, 'x‮.md']) {
      expect(resolveExportPath(bad, roots).ok, bad).toBe(false)
    }

    expect(resolveExportPath('out/with space.md', roots)).toEqual({ ok: true, path: `${dir}/out/with space.md` })
  })

  it('refuses to write through a link (folder or file) and never overwrites an existing file', async () => {
    await symlink(outside, join(dir, 'linked'))
    await writeFile(join(outside, 'victim.md'), 'keep')
    await symlink(join(outside, 'victim.md'), join(dir, 'file-link.md'))
    await writeFile(join(dir, 'exists.md'), 'mine')

    const roots = { cwd: dir, scratch: null }

    for (const rel of ['linked/new.md', 'file-link.md', 'exists.md']) {
      const wanted = resolveExportPath(rel, roots)

      expect(wanted.ok).toBe(true)
      expect((await checkNoLinks(fsOf, (wanted as { path: string }).path, roots)).ok, rel).toBe(false)
    }

    // The disk half holds even if the check were skipped: conv=excl (GNU) or noclobber's O_EXCL (sh) refuses an existing file and a dangling link.
    await symlink(join(outside, 'not-yet.md'), join(dir, 'dangling.md'))

    for (const rel of ['exists.md', 'dangling.md']) {
      const result = await run(newFileArgv(join(dir, rel), true, await writeFlavorReady()), 5000, 'PWNED')

      expect(result.exitCode, rel).not.toBe(0)
    }

    expect(await readFile(join(outside, 'victim.md'), 'utf8')).toBe('keep')
    expect(await readFile(join(dir, 'exists.md'), 'utf8')).toBe('mine')
    expect(await statOf(join(outside, 'not-yet.md')).catch(() => null)).toBeNull()
  })

  it('writes a summary whose name has spaces and a leading dash-free base as one argv element, content on stdin', async () => {
    const path = `${dir}/odd name; $(touch pwned) \`id\`.md`
    const result = await run(newFileArgv(path, true, await writeFlavorReady()), 5000, '# hi\n')

    expect(result.exitCode).toBe(0)
    expect(await readFile(path, 'utf8')).toBe('# hi\n')
    expect(await statOf(join(dir, 'pwned')).catch(() => null)).toBeNull()
  })

  it('the export spec carries a fixed argv (no shell on GNU, one constant script with the path as $1 on BSD) and the text only on stdin', async () => {
    const flavor = await writeFlavorReady()
    const spec = exportSpec(`${dir}/a.md`, '# x', 'run', true, flavor)

    expect(spec.argv).toEqual(flavor === 'gnu' ? ['dd', `of=${dir}/a.md`, 'conv=excl', 'status=none'] : posixCreateExclusive(`${dir}/a.md`))
    expect(spec.stdin).toBe('# x')
    expect(spec.declared).toBe('write')
    expect(exportName(runOf('wf_x', BASE, {}, '../../etc/passwd; rm -rf /'))).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/)
  })

  it('does not write saved views through a linked .claude-flow folder or a linked wf-views.json', async () => {
    const victim = join(outside, 'victim.txt')

    await writeFile(victim, 'precious')

    const state = newState({})

    state.cwd = dir
    state.view = 'workflows'
    state.wf.read = { runs: [runOf('wf_a', BASE), runOf('wf_b', BASE)], root: '/x', capBytes: 1, skipped: 0, more: 0 }

    const host = { fs: fsOf, run } as never

    // 1. wf-views.json is a link to a file the person can write.
    await mkdir(join(dir, '.claude-flow/console'), { recursive: true })
    await symlink(victim, join(dir, '.claude-flow/console/wf-views.json'))
    await syncSavedViews(state, host, 1000)
    updateSaved(dir, s => setSearch(s, 'x'))
    await syncSavedViews(state, host, 100_000)
    expect(await readFile(victim, 'utf8')).toBe('precious')
    expect(savedFor(dir).error).toMatch(/link/)

    // 2. the whole console folder is a link to somewhere else.
    await rm(join(dir, '.claude-flow'), { recursive: true })
    await mkdir(join(outside, 'console'))
    await symlink(outside, join(dir, '.claude-flow'))
    resetSavedLive()
    await syncSavedViews(state, host, 200_000)
    updateSaved(dir, s => setSearch(s, 'y'))
    await syncSavedViews(state, host, 300_000)
    expect(await statOf(join(outside, 'console/wf-views.json')).catch(() => null)).toBeNull()
    expect(savedFor(dir).error).toMatch(/link/)
  })

  it('writes the saved views normally when nothing is a link', async () => {
    const state = newState({})

    state.cwd = dir
    state.view = 'workflows'
    state.wf.read = { runs: [runOf('wf_a', BASE)], root: '/x', capBytes: 1, skipped: 0, more: 0 }
    await syncSavedViews(state, { fs: fsOf, run } as never, 1000)
    updateSaved(dir, s => setSearch(s, 'needle'))
    await syncSavedViews(state, { fs: fsOf, run } as never, 100_000)
    expect(savedFor(dir).error).toBeNull()
    expect(decodeSaved(await readFile(savedPathOf(dir), 'utf8')).saved.search).toBe('needle')
  })
})

describe('JSON from files cannot pollute or smuggle', () => {
  it('ignores __proto__, constructor and prototype keys in the saved file and in a run record', () => {
    const text = '{"version":1,"__proto__":{"polluted":"yes"},"filters":{"__proto__":"x","constructor":"c","prototype":"p","state":"ok"},"drill":{"__proto__":{"polluted":"drill"},"runId":"wf_a"},"pins":[{"__proto__":{"polluted":"pin"},"runId":"wf_a","name":"n"}]}'
    const decoded = decodeSaved(text)

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(decoded.saved.filters)).toBe(Object.prototype)
    expect(decoded.saved.filters.state).toBe('ok')
    expect(Object.keys(decoded.saved.filters)).not.toContain('__proto__')
    expect(setFilter(emptySaved(), '__proto__', 'x')).toEqual(emptySaved())
    expect(JSON.parse(encodeSaved(decoded.saved, 1)).polluted).toBeUndefined()

    const run = runOf('wf_p', BASE, JSON.parse('{"__proto__":{"polluted":"run"},"constructor":{"prototype":{"polluted":"ctor"}}}'))

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(run.id).toBe('wf_p')
  })

  it('survives deep nesting, huge arrays and non-object roots without throwing', () => {
    const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`

    expect(() => decodeSaved(deep)).not.toThrow()
    expect(decodeSaved(JSON.stringify({ version: 1, pins: Array.from({ length: 100_000 }, (_, i) => ({ runId: `wf_${i}`, name: 'n' })) })).saved.pins.length).toBeLessThanOrEqual(20)
    expect(() => parseJournal(`${'{"type":"started","agentId":'.repeat(50_000)}`)).not.toThrow()
  })
})

describe('free text that becomes an argv', () => {
  it('refuses a leading dash, a credential and control characters; keeps the text one element', () => {
    for (const bad of ['--force', '-rf /', '  -x', `${ESC}[31m--x`, 'use sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'DB_PASS=letmein99', '', '   ']) expect(guardText(bad, 300).ok, bad).toBe(false)

    const ok = guardText('line one\nline two; $(id) `x` ‮', 300)

    expect(ok.ok).toBe(true)
    expect((ok as { text: string }).text).not.toMatch(/[\n‮]/)
  })
})
