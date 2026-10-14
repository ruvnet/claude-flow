/**
 * #4090 follow-up: a repository's own config can name a filter driver (filter.<name>.clean, .smudge, .process) that git runs while it compares
 * a work tree with HEAD, so status, diff and `worktree remove` execute it. The console reads and removes worktrees of projects it did not make,
 * so it lists the configured drivers (a config read, nothing runs) and blanks each one on the command line before the git command that would
 * run it. Every real-git case has a positive control: the same config runs the program under the plain command.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, rm, utimes, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { diffArgv } from '../hooks/data/wf-drill-io'
import { FILTER_KEYS_ARGV, filterGuarded, filterOverrides } from '../hooks/data/git-filters'
import { REMOVE_ARGV, STATUS_ARGV } from '../hooks/data/wf-worktrees'

const sh = promisify(execFile)
const isWin = process.platform === 'win32'
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const run = async (argv: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  try {
    const out = await sh(argv[0] as string, argv.slice(1) as string[], { env: ENV, timeout: 20_000 })

    return { stdout: out.stdout, stderr: out.stderr, exitCode: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number }

    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: typeof e.code === 'number' ? e.code : 1 }
  }
}

describe('filterOverrides: the drivers git lists become empty command-line overrides', () => {
  it('blanks clean, smudge and process for every driver, dotted names included, once each', () => {
    const overrides = filterOverrides('filter.evil.clean\nfilter.evil.smudge\nfilter.a.b.process\nfilter.evil.process\n')

    expect(overrides).toEqual(['-c', 'filter.evil.clean=', '-c', 'filter.evil.smudge=', '-c', 'filter.a.b.process=', '-c', 'filter.evil.process='])
  })

  it('is empty when no driver is configured', () => {
    expect(filterOverrides('')).toEqual([])
    expect(filterOverrides('\n')).toEqual([])
  })

  it('fails closed (null) on a name it cannot override exactly: an equals sign, a space, a control character or an odd key', () => {
    for (const text of ['filter.a=b.clean\n', 'filter.a b.clean\n', 'filter.a\u0001.clean\n', 'filter..clean\n', 'filter.x.clean.extra\n', 'other.x.clean\n']) {
      expect(filterOverrides(text), JSON.stringify(text)).toBeNull()
    }
  })

  it('the listing is a config read with a fixed argv', () => {
    const argv = FILTER_KEYS_ARGV('/x')

    expect(argv.slice(0, 3)).toEqual(['git', '-C', '/x'])
    expect(argv).toContain('config')
    expect(argv).toContain('--get-regexp')
    expect(argv.join(' ')).not.toMatch(/\s(-c|status|diff|remove)\s/)
  })
})

describe('filterGuarded: the argv gains the overrides, or the command is refused', () => {
  const ok = (stdout: string, exitCode = 0) => async () => ({ stdout, stderr: '', exitCode })

  it('puts the overrides right after git and leaves every other word in place', async () => {
    const argv = await filterGuarded(ok('filter.evil.clean\n'), '/wt', ['git', '-C', '/wt', 'status'])

    expect(argv).toEqual(['git', '-c', 'filter.evil.clean=', '-C', '/wt', 'status'])
  })

  it('returns the argv unchanged when git finds no driver (exit 1, nothing printed)', async () => {
    const argv = await filterGuarded(ok('', 1), '/wt', ['git', '-C', '/wt', 'status'])

    expect(argv).toEqual(['git', '-C', '/wt', 'status'])
  })

  it('refuses (null) when the listing fails, throws, or names something it cannot blank', async () => {
    expect(await filterGuarded(ok('', 128), '/wt', ['git', 'status'])).toBeNull()
    expect(await filterGuarded(async () => { throw new Error('boom') }, '/wt', ['git', 'status'])).toBeNull()
    expect(await filterGuarded(ok('filter.a b.clean\n'), '/wt', ['git', 'status'])).toBeNull()
  })

  it('refuses an argv that does not start with git', async () => {
    expect(await filterGuarded(ok(''), '/wt', ['rm', '-rf', '/'])).toBeNull()
  })
})

describe.skipIf(isWin)('real git: a configured filter driver does not run', () => {
  let dir = ''
  let mark = ''

  const setup = async (name: string, kind: 'clean' | 'process' | 'smudge', driver: string): Promise<{ main: string; wt: string }> => {
    const main = join(dir, name)

    await sh('git', ['init', '-q', main], { env: ENV })
    await sh('git', ['-C', main, 'config', 'user.email', 'a@b.c'], { env: ENV })
    await sh('git', ['-C', main, 'config', 'user.name', 't'], { env: ENV })
    await writeFile(join(main, 'a'), 'a\n')
    await writeFile(join(main, 'f.txt'), 'hi\n')
    await writeFile(join(main, '.gitattributes'), `*.txt filter=${driver}\n`)
    await sh('git', ['-C', main, 'add', '.'], { env: ENV })
    await sh('git', ['-C', main, 'commit', '-qm', 'c'], { env: ENV })
    await sh('git', ['-C', main, 'worktree', 'add', '-q', join(main, '.git-worktrees', 'w1'), '-b', 'w1'], { env: ENV })

    const script = join(dir, `${name}.sh`)

    await writeFile(script, `#!/bin/sh\necho ran >> ${mark}\ncat\n`)
    await chmod(script, 0o755)
    await sh('git', ['-C', main, 'config', `filter.${driver}.${kind}`, script], { env: ENV })

    const wt = join(main, '.git-worktrees', 'w1')

    // a stale mtime makes git compare content, which is when it runs the clean filter
    await utimes(join(wt, 'f.txt'), new Date('2001-01-01'), new Date('2001-01-01'))

    return { main, wt }
  }

  const ran = async (): Promise<boolean> => (await readFile(mark, 'utf8').catch(() => '')).includes('ran')
  const reset = async (): Promise<void> => { await rm(mark, { force: true }) }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rfc-filter-'))
    mark = join(dir, 'MARK')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('status: the plain probe runs the driver (control), the guarded one does not', async () => {
    const { wt } = await setup('s', 'clean', 'evil')

    await reset()
    await run(STATUS_ARGV(wt))
    expect(await ran(), 'positive control: the unguarded probe runs the driver').toBe(true)

    await reset()
    const guarded = await filterGuarded(run, wt, STATUS_ARGV(wt))

    expect(guarded).not.toBeNull()
    await run(guarded as string[])
    expect(await ran()).toBe(false)
  })

  it('diff: the guarded numstat does not run a clean driver', async () => {
    const { wt } = await setup('d', 'clean', 'evil')

    await reset()
    await run(diffArgv(wt))
    expect(await ran(), 'positive control').toBe(true)

    await reset()
    await run((await filterGuarded(run, wt, diffArgv(wt))) as string[])
    expect(await ran()).toBe(false)
  })

  it('removal: the guarded git worktree remove does not run the driver and still removes a clean worktree', async () => {
    const { main, wt } = await setup('r', 'clean', 'evil')

    await reset()
    const guarded = await filterGuarded(run, wt, REMOVE_ARGV(main, wt))

    expect(guarded).not.toBeNull()
    await run(guarded as string[])
    expect(await ran()).toBe(false)
    expect((await run(['git', '-C', main, 'worktree', 'list', '--porcelain'])).stdout).not.toContain('.git-worktrees/w1')
  })

  it('a dotted driver name and a process driver are blanked too', async () => {
    const { wt } = await setup('p', 'process', 'evil.dotted')

    await reset()
    await run(STATUS_ARGV(wt))
    expect(await ran(), 'positive control: process drivers run under status').toBe(true)

    await reset()
    await run((await filterGuarded(run, wt, STATUS_ARGV(wt))) as string[])
    expect(await ran()).toBe(false)
  })

  it('a driver name the console cannot blank exactly stops the probe (null) instead of running it', async () => {
    const { wt } = await setup('x', 'clean', 'with space')

    await reset()
    expect(await filterGuarded(run, wt, STATUS_ARGV(wt))).toBeNull()
    expect(await ran()).toBe(false)
  })
})
