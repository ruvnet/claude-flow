/**
 * A repository's own config and .git/hooks can name programs git runs: core.fsmonitor when a command compares the work tree with the index,
 * and post-index-change when one rewrites the index. The console runs git in worktrees and projects it did not make, so its fixed probes switch
 * the fsmonitor off, and removal and describe (which can rewrite the index) also turn hooks off. Removal also lists untracked files whatever
 * status.showUntrackedFiles says, so a worktree holding new files is never read as clean and deleted. Each real-git case has a positive control:
 * the same config does its harm under the plain command, so a marker that stays absent means the guard held, not that the probe could not see it.
 *
 * Filter drivers are covered in git-filter-guard.spec.ts. Not covered here: lazy fetches in a partial clone, changes hidden by index flags (assume-unchanged,
 * skip-worktree, core.ignoreStat), and commands the person configures themselves (mission gates).
 */
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdtemp, readdir, readFile, rm, stat as statOf, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { changedFiles } from '../hooks/adr-mission'
import { diffArgv } from '../hooks/data/wf-drill-io'
import { IGNORED_ARGV, REMOVE_ARGV, STATUS_ARGV } from '../hooks/data/wf-worktrees'

const sh = promisify(execFile)
const PLUGIN = join(__dirname, '..')
const isWin = process.platform === 'win32'
const exists = async (path: string): Promise<boolean> => (await statOf(path).catch(() => null)) !== null

/** Subcommands that compare the work tree with the index, so a repository's core.fsmonitor runs under them. */
const FSMONITOR = /'(status|describe|diff|diff-files|diff-index|ls-files|add|update-index)'|'worktree','remove'/
/** Of those, the ones that can write the index and so fire post-index-change even with --no-optional-locks. */
const WRITES_INDEX = /'describe'|'worktree','remove'/

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : Promise.resolve(/\.(m?ts|m?js)$/.test(entry.name) ? [join(dir, entry.name)] : []))))

  return nested.flat()
}

/** Every array literal in the plugin's runtime code that starts with git, quotes normalised to ' and whitespace removed. */
async function gitLiterals(): Promise<{ where: string; literal: string }[]> {
  const out: { where: string; literal: string }[] = []

  for (const dir of ['hooks', 'tui']) {
    for (const file of await sourceFiles(join(PLUGIN, dir))) {
      const text = await readFile(file, 'utf8')

      for (const match of text.matchAll(/\[\s*["'`]git["'`]\s*,[^\]]*\]/g)) out.push({ where: file.slice(PLUGIN.length + 1), literal: match[0].replace(/["`]/g, "'").replace(/\s+/g, '') })
    }
  }

  return out
}

describe('the fixed git argv the console builds', () => {
  it('the builders for status, ignored files, diff and removal carry core.fsmonitor=false; removal also turns hooks off and lists untracked files', () => {
    for (const argv of [STATUS_ARGV('/x'), IGNORED_ARGV('/x'), diffArgv('/x'), REMOVE_ARGV('/main', '/main/.claude/worktrees/x')]) {
      expect(argv.join(' '), argv.join(' ')).toContain('-c core.fsmonitor=false')
    }

    expect(REMOVE_ARGV('/main', '/p').join(' ')).toContain('-c core.hooksPath=/dev/null -c status.showUntrackedFiles=normal worktree remove')
    expect(REMOVE_ARGV('/main', '/p').at(-1)).toBe('/p')
    expect(STATUS_ARGV('/x')).toContain('--untracked-files=normal')
  })

  it('no git array literal in hooks/ or tui/ reaches an fsmonitor or index-writing subcommand without its guard, and none sets the fsmonitor back', async () => {
    const literals = await gitLiterals()
    const unguarded = literals.filter(({ literal }) => FSMONITOR.test(literal) && !literal.includes("'-c','core.fsmonitor=false'"))
    const hooksOn = literals.filter(({ literal }) => WRITES_INDEX.test(literal) && !literal.includes("'-c','core.hooksPath=/dev/null'"))
    const overridden = literals.filter(({ literal }) => (literal.match(/core\.fsmonitor=/g) ?? []).length > 1)

    expect(literals.length).toBeGreaterThan(5) // the scan sees the probes it is meant to check
    expect(unguarded.map(({ where, literal }) => `${where}: ${literal}`)).toEqual([])
    expect(hooksOn.map(({ where, literal }) => `${where}: ${literal}`)).toEqual([])
    expect(overridden).toEqual([])
  })
})

describe.skipIf(isWin)('against real git', () => {
  let base: string
  let main: string
  const fsmonitorMarker = (): string => join(base, 'fsmonitor-ran')
  const hookMarker = (): string => join(base, 'hook-ran')
  const git = async (cwd: string, ...args: string[]): Promise<string> => (await sh('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args])).stdout
  const runArgv = (argv: readonly string[]): Promise<number> =>
    new Promise(resolve => {
      const child = spawn(argv[0] as string, argv.slice(1), { stdio: 'ignore' })

      child.on('close', code => resolve(code ?? -1))
      child.on('error', () => resolve(127))
    })
  const hostile = async (): Promise<void> => {
    await rm(fsmonitorMarker(), { force: true })
    await rm(hookMarker(), { force: true })
    await git(main, 'config', 'core.fsmonitor', `touch ${fsmonitorMarker()}; false`)
  }
  // A new mtime with the same content: the index entry goes stale, so a command that refreshes the index rewrites it.
  let tick = 1
  const restat = async (): Promise<void> => {
    const when = new Date(Date.UTC(2020, 0, tick++))

    await utimes(join(main, 'a.txt'), when, when)
  }

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'git-config-exec-'))
    main = join(base, 'main')
    await sh('git', ['init', '-b', 'main', main])
    await writeFile(join(main, 'a.txt'), 'one\n')
    await git(main, 'add', '.')
    await git(main, 'commit', '-m', 'init')

    const hook = join(main, '.git', 'hooks', 'post-index-change')

    await writeFile(hook, `#!/bin/sh\ntouch '${hookMarker()}'\n`)
    await chmod(hook, 0o755)
  }, 30_000)

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('control: the plain removal runs the hostile fsmonitor and the post-index-change hook', async () => {
    const path = join(base, 'wt-control')

    await git(main, 'worktree', 'add', '-b', 'b-control', path)
    await hostile()
    expect(await runArgv(['git', '-C', main, 'worktree', 'remove', path])).toBe(0)
    expect(await exists(path)).toBe(false)
    expect(await exists(fsmonitorMarker())).toBe(true)
    expect(await exists(hookMarker())).toBe(true)
  }, 30_000)

  it('REMOVE_ARGV removes the worktree and runs neither', async () => {
    const path = join(base, 'wt-guarded')

    await git(main, 'worktree', 'add', '-b', 'b-guarded', path)
    await hostile()
    expect(await runArgv(REMOVE_ARGV(main, path))).toBe(0)
    expect(await exists(path)).toBe(false)
    expect(await exists(fsmonitorMarker())).toBe(false)
    expect(await exists(hookMarker())).toBe(false)
  }, 30_000)

  it('with status.showUntrackedFiles=no, the probe still sees a new file and REMOVE_ARGV refuses; the plain removal deletes it (control)', async () => {
    await git(main, 'config', '--unset', 'core.fsmonitor').catch(() => '')
    await git(main, 'config', 'status.showUntrackedFiles', 'no')

    try {
      const control = join(base, 'wt-untracked-control')
      const guarded = join(base, 'wt-untracked')

      for (const [path, branch] of [[control, 'b-untracked-control'], [guarded, 'b-untracked']] as const) {
        await git(main, 'worktree', 'add', '-b', branch, path)
        await writeFile(join(path, 'unsaved.txt'), 'new work\n')
      }

      expect(await runArgv(['git', '-C', main, 'worktree', 'remove', control])).toBe(0)
      expect(await exists(join(control, 'unsaved.txt'))).toBe(false)

      expect((await sh(STATUS_ARGV(guarded)[0] as string, STATUS_ARGV(guarded).slice(1) as string[])).stdout).toContain('?? unsaved.txt')
      expect(await runArgv(REMOVE_ARGV(main, guarded))).not.toBe(0)
      expect(await readFile(join(guarded, 'unsaved.txt'), 'utf8')).toBe('new work\n')
    } finally {
      await git(main, 'config', '--unset', 'status.showUntrackedFiles')
    }
  }, 30_000)

  it("register.ts's describe argv, run as written, runs neither (control: plain describe --dirty fires the hook)", async () => {
    const source = await readFile(join(PLUGIN, 'hooks', 'register.ts'), 'utf8')
    const literal = source.match(/\[\s*'git'[^\]]*'describe'[^\]]*\]/)?.[0]

    expect(literal).toBeDefined()

    // Its elements are quoted words and the identifier `root`; run it with root set to the hostile repository.
    const argv = [...(literal as string).matchAll(/'([^']*)'|([A-Za-z_]\w*)/g)].map(([, word, name]) => (word !== undefined ? word : name === 'root' ? main : `?${name}`))

    expect(argv.some(word => word.startsWith('?'))).toBe(false)

    await hostile()
    await restat()
    expect(await runArgv(['git', '-C', main, 'describe', '--always', '--dirty'])).toBe(0)
    expect(await exists(hookMarker())).toBe(true)

    await hostile()
    await restat()
    expect(await runArgv(argv)).toBe(0)
    expect(await exists(fsmonitorMarker())).toBe(false)
    expect(await exists(hookMarker())).toBe(false)
  }, 30_000)

  it('the mission scope check reads changed files without running the hostile fsmonitor (control: plain status runs it)', async () => {
    await writeFile(join(main, 'a.txt'), 'changed\n')
    await hostile()
    expect(await runArgv(['git', '-C', main, 'status', '--porcelain'])).toBe(0)
    expect(await exists(fsmonitorMarker())).toBe(true)

    await hostile()

    const host = {
      run: async (argv: readonly string[]) => {
        try {
          const { stdout, stderr } = await sh(argv[0] as string, argv.slice(1) as string[])

          return { exitCode: 0, stdout, stderr }
        } catch (error) {
          return { exitCode: 1, stdout: '', stderr: String(error) }
        }
      },
    }

    expect(await changedFiles(host, main, Date.now())).toContain('a.txt')
    expect(await exists(fsmonitorMarker())).toBe(false)
    await git(main, 'checkout', '--', 'a.txt')
  }, 30_000)
})
