/**
 * Export of a run summary (ADR-461): the markdown (masked, escaped, capped), the path rules, and the fixed-argv write.
 * Run with  npx vitest run plugins/ruflo-console/tests/wf-export.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { exportName, exportSpec, MAX_EXPORT_BYTES, runMarkdown } from '../hooks/data/wf-export'
import { checkNoLinks, newFileArgv, removeFileArgv, replaceFileArgv, resolveExportPath } from '../hooks/data/wf-file'
import { BASE, runOf } from './fixtures/wf-runs'
import { nativeWriteFlavor } from './fixtures/write-flavor'

const KEY = 'sk-abcdefghijklmnopqrstuvwx'
const ROOTS = { cwd: '/work/proj', scratch: '/home/u/.cache/claude-code/tmp/s1' }

describe('the markdown', () => {
  it('holds the phases, agents, tokens, time and a provenance line, with cost n/a by default', () => {
    const md = runMarkdown(runOf('wf_a', BASE), { nowMs: Date.parse('2026-10-06T02:00:00Z') })

    expect(md).toMatch(/^# Workflow run: demo-run/)
    expect(md).toMatch(/## 1\. Build/)
    expect(md).toMatch(/## 2\. Review/)
    expect(md).toMatch(/\| build:a \| done \| n\/a \| 180\.0k \| 1m00s \| n\/a \|/)
    expect(md).toMatch(/\| Cost \| n\/a \(no cost source for this run\) \|/)
    expect(md).toMatch(/run record Claude Code wrote/)
  })

  it('shows a cost only with its source', () => {
    const md = runMarkdown(runOf('wf_a', BASE), { nowMs: 0, cost: { usd: 1.234, source: 'cost ledger' } })

    expect(md).toMatch(/\$1\.23 \(cost ledger\)/)
    expect(runMarkdown(runOf('wf_a', BASE), { nowMs: 0, cost: { usd: null, source: 'x' } })).toMatch(/n\/a/)
  })

  it('masks credentials and strips control characters and escapes table characters in every free-text field', () => {
    const run = runOf('wf_a', [{ id: 'z1', label: `bad|label ${KEY} \u001b[31mred`, phase: 'Build', at: 0, ms: 1, tokens: 5 }], { workflowName: `name ${KEY}` }, `name ${KEY}`)
    const withResult = { ...run, phases: run.phases.map(p => ({ ...p, agents: p.agents.map(a => ({ ...a, resultPreview: `token=${KEY} and Bearer abcdefghijklmnop\nnext` })) })) }
    const md = runMarkdown(withResult, { nowMs: 0 })

    expect(md).not.toContain(KEY)
    expect(md).not.toContain('abcdefghijklmnop')
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(md)).toBe(false)
    expect(md).toContain('bad\\|label')
    expect(md).toContain('‹masked›')
  })

  it('is capped, and says where it was cut', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `m${i}`, label: `agent number ${i} with a long enough label to fill the file quickly`, phase: 'Build', at: i, ms: 1, tokens: i }))
    const md = runMarkdown(runOf('wf_big', many), { nowMs: 0 })

    expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(MAX_EXPORT_BYTES)
    expect(md).toMatch(/Cut here: this summary is capped/)
  })

  it('names the file from the run, safely', () => {
    expect(exportName(runOf('wf_a', BASE, {}, '../../etc/pass wd'))).toBe('etc-pass-wd-wf_a.md')
    expect(exportName(runOf('wf_a', BASE, {}, 'wf_a'))).toBe('wf_a.md')
  })
})

describe('the path', () => {
  const ok = (p: string) => resolveExportPath(p, ROOTS)

  it('accepts a relative path inside the project and an absolute one in the scratchpad', () => {
    expect(ok('out/run.md')).toEqual({ ok: true, path: '/work/proj/out/run.md' })
    expect(ok('./a//b/run.md')).toEqual({ ok: true, path: '/work/proj/a/b/run.md' })
    expect(ok('/home/u/.cache/claude-code/tmp/s1/run.md')).toMatchObject({ ok: true })
  })

  it('refuses traversal, other roots, other extensions, control characters, ~ and a lookalike prefix', () => {
    for (const bad of ['../x.md', 'a/../../x.md', '/etc/x.md', '/work/proj2/x.md', '/work/proj/../etc/x.md', 'x.txt', 'x.md\u0000', 'x\u001b.md', '~/x.md', 'a\\b.md', '', '   ', '.md', '/work/proj/-x/.md', `${'a/'.repeat(200)}x.md`]) {
      expect(ok(bad), JSON.stringify(bad)).toMatchObject({ ok: false })
    }
  })

  it('refuses the scratchpad when none is known', () => {
    expect(resolveExportPath('/home/u/x.md', { cwd: '/work/proj' })).toMatchObject({ ok: false })
  })

  it('refuses a link on the way down and a file already there; a missing path is fine', async () => {
    const stat = (table: Record<string, { isLink?: boolean; kind?: string }>) => async (path: string) => table[path] ?? Promise.reject(new Error('ENOENT'))

    expect(await checkNoLinks({ stat: stat({}) }, '/work/proj/out/run.md', ROOTS)).toMatchObject({ ok: true })
    expect(await checkNoLinks({ stat: stat({ '/work/proj/out': { isLink: true } }) }, '/work/proj/out/run.md', ROOTS)).toMatchObject({ ok: false, why: expect.stringMatching(/is a link/) })
    expect(await checkNoLinks({ stat: stat({ '/work/proj/out': { kind: 'file' } }) }, '/work/proj/out/run.md', ROOTS)).toMatchObject({ ok: false, why: expect.stringMatching(/not a folder/) })
    expect(await checkNoLinks({ stat: stat({ '/work/proj/out': { kind: 'dir' }, '/work/proj/out/run.md': { kind: 'file' } }) }, '/work/proj/out/run.md', ROOTS)).toMatchObject({ ok: false, why: expect.stringMatching(/already exists/) })
    expect(await checkNoLinks({ stat: stat({ '/work/proj/out/run.md': { kind: 'file' } }) }, '/work/proj/out/run.md', ROOTS, { allowExisting: true })).toMatchObject({ ok: true })
    expect(await checkNoLinks({ stat: stat({}) }, '/elsewhere/run.md', ROOTS)).toMatchObject({ ok: false })
  })
})

describe('the write', () => {
  it('is a command with no shell: the path is one element, whatever it says', () => {
    const evil = '/work/proj/a b;$(rm -rf ~)`x`.md'

    expect(newFileArgv(evil, true, 'gnu')).toEqual(['dd', `of=${evil}`, 'conv=excl', 'status=none'])
    expect(newFileArgv(evil, false, 'gnu')).toEqual(['install', '-D', '-m', '0644', '/dev/stdin', '--', evil])
    expect(replaceFileArgv(evil, true, 'gnu')).toEqual(['dd', `of=${evil}`, 'status=none'])
    expect(replaceFileArgv(evil, false, 'gnu')).toEqual(newFileArgv(evil, false, 'gnu'))
    expect(removeFileArgv(evil)).toEqual(['rm', '-f', '--', evil])
    for (const argv of [newFileArgv(evil, true, 'gnu'), newFileArgv(evil, false, 'gnu'), replaceFileArgv(evil, true, 'gnu'), removeFileArgv(evil)]) expect(argv.some(part => part === 'sh' || part === 'bash' || part === '-c')).toBe(false)
  })

  it('a new file never replaces one: the exclusive create refuses an existing file on a real disk, with this machine\'s tools', async () => {
    const { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { spawnSync } = await import('node:child_process')
    const { tmpdir } = await import('node:os')
    const flavor = await nativeWriteFlavor()
    const dir = mkdtempSync(`${tmpdir()}/wf-export-`)
    const file = `${dir}/a b;$(x).md`
    // stdin from a file descriptor, not Node's socket pair: GNU `install -D /dev/stdin` reopens stdin and refuses a socket.
    const write = (input: string, path = file, hasDir = true) => {
      writeFileSync(`${dir}.in`, input)

      const fd = openSync(`${dir}.in`, 'r')

      try {
        const [cmd, ...args] = newFileArgv(path, hasDir, flavor) as string[]

        return spawnSync(cmd as string, args, { stdio: [fd, 'pipe', 'pipe'] })
      } finally {
        closeSync(fd)
      }
    }

    try {
      const first = write('one\n')

      expect(first.status).toBe(0)
      expect(readFileSync(file, 'utf8')).toBe('one\n')

      const second = write('two\n')

      expect(second.status).not.toBe(0)
      expect(readFileSync(file, 'utf8')).toBe('one\n')

      // No folder yet: it is made, then the file (GNU install -D, or mkdir -p and the exclusive create).
      const deep = `${dir}/new dir/$(y)/b.md`

      expect(write('deep\n', deep, false).status).toBe(0)
      expect(readFileSync(deep, 'utf8')).toBe('deep\n')
      expect(spawnSync('test', ['-e', `${dir}/x`]).status).not.toBe(0)
      expect(spawnSync('test', ['-e', `${dir}/y`]).status).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(`${dir}.in`, { force: true })
    }
  })

  it('is a confirm-gated spec: argv, text on stdin, declared write, verified on disk', async () => {
    const spec = exportSpec('/work/proj/o.md', '# hi\n', 'demo', true, 'gnu')

    expect(spec).toMatchObject({ argv: newFileArgv('/work/proj/o.md', true, 'gnu'), stdin: '# hi\n', declared: 'write', args: [] })
    expect(spec.shows).toMatch(/never overwrites/)
    expect(await spec.verifyLocal?.({ fs: { stat: async () => ({ size: 1 }) } } as never)).toBe(true)
    expect(await spec.verifyLocal?.({ fs: { stat: async () => Promise.reject(new Error('x')) } } as never)).toBe(false)
  })
})
