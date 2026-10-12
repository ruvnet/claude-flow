/**
 * Security audit of the worktree removal guard, against REAL git: a throwaway repository with an origin, and worktrees that are merged and
 * clean (the only one that may go), dirty, untracked, unmerged, locked, in use by a live process, the one a session is in, too young, outside
 * the allowed folders, holding an ignored .env, and one named like a command line. The guard is the production one (views/wf-worktrees.ts)
 * driven through its confirm spec; only the host is real instead of faked. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-security-worktrees.spec.ts --testTimeout=60000
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, stat as statOf, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newWfUi } from '../hooks/data/workflows-nav'
import { IGNORED_ARGV, MIN_AGE_MS, planRemoval, STATUS_ARGV, type WtRow } from '../hooks/data/wf-worktrees'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import type { SlotEnv } from '../hooks/views/wf-slots'
import { refreshWorktrees, removalSpec, resetWorktrees, storeFor, wireWfWorktrees } from '../hooks/views/wf-worktrees'

const sh = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> => (await sh('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args])).stdout
const exists = async (path: string): Promise<boolean> => (await statOf(path).catch(() => null)) !== null

let base: string
let main: string
let state: State
let host: Host
const children: ChildProcess[] = []
const wtPath = (name: string): string => `${main}/.claude/worktrees/${name}`
const OLD = ['old', 'old-2', '-rf --force x y', 'dirty', 'untracked', 'ahead', 'locked', 'busy', 'current', 'secret']

const run = async (argv: readonly string[], _ms: number, stdin?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const input = join(base, `in-${Math.random().toString(36).slice(2)}`)

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

const envOf = (): SlotEnv => ({ ctx: { kit: {}, state, nowMs: Date.now(), columns: 120, pictures: new Map(), act: {} as never } as unknown as Ctx, runs: [], run: null, phase: null, agent: null, ui: newWfUi(), nowMs: Date.now() })

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'wf-wt-'))
  main = join(base, 'main')

  const origin = join(base, 'origin.git')

  await sh('git', ['init', '--bare', '-b', 'main', origin])
  await sh('git', ['init', '-b', 'main', main])
  await writeFile(join(main, '.gitignore'), '.env\n.claude/worktrees/\n.git-worktrees/\n')
  await writeFile(join(main, 'a.txt'), 'one\n')
  await git(main, 'add', '.')
  await git(main, 'commit', '-m', 'init')
  await git(main, 'remote', 'add', 'origin', origin)
  await git(main, 'push', '-u', 'origin', 'main')
  await git(main, 'fetch', 'origin')
  await mkdir(join(main, '.claude/worktrees'), { recursive: true })

  for (const name of OLD) await git(main, 'worktree', 'add', '-b', `b-${name.replace(/[^a-z0-9]/g, '')}`, wtPath(name))

  // A worktree outside the allowed folders, and one just made.
  await git(main, 'worktree', 'add', '-b', 'b-outside', join(base, 'outside-wt'))
  await git(main, 'worktree', 'add', '-b', 'b-young', wtPath('young'))

  await writeFile(join(wtPath('dirty'), 'a.txt'), 'changed\n')
  await writeFile(join(wtPath('untracked'), 'new.txt'), 'new\n')
  await writeFile(join(wtPath('ahead'), 'b.txt'), 'b\n')
  await git(wtPath('ahead'), 'add', 'b.txt')
  await git(wtPath('ahead'), 'commit', '-m', 'unmerged work')
  await git(main, 'worktree', 'lock', wtPath('locked'))
  await writeFile(join(wtPath('secret'), '.env'), 'API_KEY=hunter2hunter2\n')
  children.push(spawn('sleep', ['300'], { cwd: wtPath('busy'), stdio: 'ignore' }))

  // Age: the worktree's `.git` file is its birth. Everything but `young` is five days old.
  const old = new Date(Date.now() - 5 * 86_400_000)

  for (const name of [...OLD, 'outside']) await utimes(name === 'outside' ? join(base, 'outside-wt/.git') : join(wtPath(name), '.git'), old, old)

  state = newState({})
  state.cwd = wtPath('current')
  host = { run, fs: { stat: async (path: string) => (await statOf(path).catch(() => undefined)) ?? undefined }, invalidate: () => undefined } as unknown as Host
  wireWfWorktrees(state, host)
}, 60_000)

afterAll(async () => {
  for (const child of children) child.kill('SIGKILL')

  resetWorktrees(state)
  await rm(base, { recursive: true, force: true })
})

const rowOf = (name: string): WtRow => storeFor(state).read?.rows.find(entry => entry.path === wtPath(name)) as WtRow

// The first three are Linux only: the in-use probe reads /proc with GNU find -printf (data/wf-worktrees.ts PROCS_ARGV), which macOS has
// neither of, so on another kernel they measure the test machine, not the guard. CI runs them on Linux.
const onLinux = process.platform === 'linux'

describe('the removal guard against a real repository', () => {
  it.skipIf(!onLinux)('offers exactly the merged, clean, idle, old, not-current worktrees, and keeps everything else with the right reason', async () => {
    await refreshWorktrees(state, host, true)

    const { read, check } = storeFor(state)

    expect(read?.rows.length).toBe(OLD.length + 3) // + main, outside, young
    expect(check?.ok).toBe(true)

    const plan = planRemoval(read ?? null, check ?? null, Date.now())
    const goes = plan.targets.map(entry => entry.path).sort()
    const why = Object.fromEntries(plan.kept.map(entry => [entry.path, entry.why]))

    expect(goes).toEqual([wtPath('old'), wtPath('old-2'), wtPath('-rf --force x y')].sort())
    expect(why[wtPath('dirty')]).toMatch(/1 changed or untracked/)
    expect(why[wtPath('untracked')]).toMatch(/1 changed or untracked/)
    expect(why[wtPath('ahead')]).toMatch(/1 commit not in origin\/main/)
    expect(why[wtPath('locked')]).toBe('locked')
    expect(why[wtPath('busy')]).toMatch(/live process/)
    expect(why[wtPath('current')]).toBe('this session is working in it')
    expect(why[wtPath('young')]).toBe('made less than a day ago')
    expect(why[wtPath('secret')]).toMatch(/1 ignored file named like a secret/)
    expect(why[join(base, 'outside-wt')]).toMatch(/outside/)
    expect(why[main]).toBe('the main worktree')
    expect(rowOf('old').createdMs).toBeLessThan(Date.now() - MIN_AGE_MS)
  })

  it.skipIf(!onLinux)('removes only those, one at a time, never a branch, and a path that reads like a command line is one argv element', async () => {
    const spec = removalSpec(envOf())

    expect(spec?.declared).toBe('delete')
    expect(spec?.run).toBeTypeOf('function')
    expect(spec?.shows).toContain('git -C')
    expect(spec?.note).toMatch(/ignore/)
    await spec?.run?.()

    for (const gone of ['old', 'old-2', '-rf --force x y']) expect(await exists(wtPath(gone)), gone).toBe(false)
    for (const kept of ['dirty', 'untracked', 'ahead', 'locked', 'busy', 'current', 'secret', 'young']) expect(await exists(wtPath(kept)), kept).toBe(true)

    expect(await exists(join(base, 'outside-wt'))).toBe(true)
    expect(await exists(join(wtPath('secret'), '.env'))).toBe(true)
    expect(await git(main, 'branch', '--list', 'b-old', 'b-old2', 'b-rfforcexy')).toMatch(/b-old/)
    expect(state.outcome?.detail).toBe('3 removed, 0 kept')
    expect(state.outcome?.verified).toBe('yes')
  })

  it.skipIf(!onLinux)('re-checks each worktree at the moment of removal: one made dirty, in use or unmerged after the confirm is kept', async () => {
    for (const name of ['race-dirty', 'race-busy', 'race-ahead', 'race-ok']) {
      await git(main, 'worktree', 'add', '-b', `b-${name}`, wtPath(name))
      await utimes(join(wtPath(name), '.git'), new Date(Date.now() - 5 * 86_400_000), new Date(Date.now() - 5 * 86_400_000))
    }

    await refreshWorktrees(state, host, true)

    const spec = removalSpec(envOf())

    expect(spec?.shows).toMatch(/race-dirty.*race-busy|race-busy.*race-dirty/s)

    // After the confirm card was shown:
    await writeFile(join(wtPath('race-dirty'), 'a.txt'), 'edited after the card\n')
    children.push(spawn('sleep', ['300'], { cwd: wtPath('race-busy'), stdio: 'ignore' }))
    await writeFile(join(wtPath('race-ahead'), 'c.txt'), 'c\n')
    await git(wtPath('race-ahead'), 'add', 'c.txt')
    await git(wtPath('race-ahead'), 'commit', '-m', 'raced')
    await new Promise(resolve => setTimeout(resolve, 150))
    await spec?.run?.()

    for (const kept of ['race-dirty', 'race-busy', 'race-ahead']) expect(await exists(wtPath(kept)), kept).toBe(true)

    expect(await exists(wtPath('race-ok'))).toBe(false)
    expect(state.outcome?.lines?.join('\n')).toMatch(/kept \S*race-dirty: 1 changed/)
    expect(await exists(join(wtPath('race-dirty'), 'a.txt'))).toBe(true)
  })

  it('every probe that can consult the repository config switches fsmonitor off and takes no optional lock', () => {
    const argv = STATUS_ARGV('/x').join(' ')

    expect(argv).toContain('--no-optional-locks')
    expect(argv).toContain('core.fsmonitor=false')
    expect(STATUS_ARGV('/x')[2]).toBe('/x')
    expect(IGNORED_ARGV('/x').join(' ')).toMatch(/--no-optional-locks -c core.fsmonitor=false ls-files/)
  })

  it('a hostile core.fsmonitor in the repository config is not run by the probe', async () => {
    const marker = join(base, 'fsmonitor-ran')

    await git(main, 'config', 'core.fsmonitor', `touch ${marker}; true`)
    await refreshWorktrees(state, host, false)
    await git(main, 'config', '--unset', 'core.fsmonitor')
    expect(await exists(marker)).toBe(false)
  })
})
