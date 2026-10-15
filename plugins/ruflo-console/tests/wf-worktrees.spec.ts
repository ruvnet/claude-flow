/**
 * The Workflows page's worktree manager, data side (ADR-463): the porcelain parser, the live-process check, the rules for what may be
 * removed, the removal plan, who made a worktree, and the fixed-argv probes.
 * Pure and fast: a stand-in for git and /proc (tests/fixtures/wf-git.ts), no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-worktrees.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { AHEAD_ARGV, BATCH, checkProcs, DIRTY_CAP, inUseOf, isRemovableDir, isSafePath, LIST_MAX_BYTES, makerOf, MAX_PROBED, MIN_AGE_MS, MIN_PROCS, parseProcs, parseWorktrees, planRemoval, PROCS_ARGV, PROCS_FRESH_MS, readWorktrees, REMOVE_ARGV, REMOVE_MAX, whyKept, type WtRow } from '../hooks/data/wf-worktrees'
import type { WfAgent, WfRun } from '../hooks/data/workflows'
import { BASE_PROCS, block, DAY, ioOf, NOW, okCheck, procLines, readOf, ROOT, row, wt, world } from './fixtures/wf-git'

describe('the porcelain parser', () => {
  it('reads the main worktree first, branches, detached, locked and prunable', () => {
    const { entries, isCut } = parseWorktrees(`${block('/r', 'main')}\n\n${block('/r/.claude/worktrees/a', null, ['locked in use'])}\n\n${block('/r/.claude/worktrees/b', 'x/y', ['prunable gone'])}\n`)

    expect(isCut).toBe(false)
    expect(entries.map(e => [e.path, e.branch, e.isMain, e.isDetached, e.isLocked, e.isPrunable])).toEqual([
      ['/r', 'main', true, false, false, false],
      ['/r/.claude/worktrees/a', null, false, true, true, false],
      ['/r/.claude/worktrees/b', 'x/y', false, false, false, true],
    ])
  })

  it('marks a path with a control character or a .. part unsafe, and cuts an over-long list', () => {
    expect(isSafePath('/a/b')).toBe(true)
    for (const bad of ['rel/path', '/a/../b', '/a/\u001b[31mb', '/a/b\nc', '/', '']) expect(isSafePath(bad)).toBe(false)
    expect(parseWorktrees(block('/r/\u001b[0m', 'm')).entries[0]?.isSafe).toBe(false)
    expect(parseWorktrees(`${block('/r', 'm')}\n\n${'x'.repeat(LIST_MAX_BYTES)}`).isCut).toBe(true)
  })

  it('only removes from under the main worktree\'s .claude/worktrees or .git-worktrees', () => {
    expect(isRemovableDir('/repo', '/repo/.claude/worktrees/a')).toBe(true)
    expect(isRemovableDir('/repo/', '/repo/.git-worktrees/a')).toBe(true)
    for (const path of ['/repo/.claude/worktrees/', '/repo/.claude/worktrees', '/repo', '/elsewhere/.claude/worktrees/a', '/repo/.claude/worktrees/../x', '/repo-other/.claude/worktrees/a']) expect(isRemovableDir('/repo', path)).toBe(false)
  })
})

describe('the live-process check', () => {
  it('counts distinct processes per worktree, nested paths and deleted targets included', () => {
    const check = parseProcs(`${BASE_PROCS}\n${procLines([[7, 'cwd', `${wt('a')}/src`], [7, 'fd/3', `${wt('a')}/f`], [8, 'exe', `${wt('a')} (deleted)`], [9, 'cwd', `${wt('ab')}`]])}`, [wt('a'), wt('ab'), wt('zz')], NOW)

    expect(check.ok).toBe(true)
    expect(inUseOf(check, wt('a'))).toBe(2)
    expect(inUseOf(check, wt('ab'))).toBe(1)
    expect(inUseOf(check, wt('zz'))).toBe(0)
    expect(inUseOf(check, wt('not-asked'))).toBeNull()
  })

  it('refuses to answer when it looks blind: fewer than the minimum working directories', async () => {
    const blind = parseProcs(procLines(Array.from({ length: MIN_PROCS - 1 }, (_, i) => [i + 1, 'cwd', '/'] as [number, string, string])), [wt('a')], NOW)

    expect(blind.ok).toBe(false)
    expect(blind.why).toMatch(/may be blind/)
    expect(inUseOf(blind, wt('a'))).toBeNull()

    const none = await checkProcs({ run: async () => ({ stdout: '', stderr: '', exitCode: 1 }), stat: async () => undefined }, [wt('a')], NOW)

    expect(none).toMatchObject({ ok: false, why: 'the process listing did not answer' })
    expect((await checkProcs({ run: async () => Promise.reject(new Error('x')), stat: async () => undefined }, [wt('a')], NOW)).ok).toBe(false)
  })

  it('reads a listing that exited non-zero (other users\' processes are unreadable) when it holds what it needs', async () => {
    const check = await checkProcs(ioOf(world()), [wt('busy')], NOW)

    expect(check.ok).toBe(true)
    expect(inUseOf(check, wt('busy'))).toBe(2)
  })
})

describe('what may be removed', () => {
  const read = readOf([])
  const check = okCheck([wt('x')])
  const why = (over: Partial<WtRow>, c = check, r = read) => whyKept(row(over), r, c, NOW)

  it('says nothing is wrong with a clean, merged, old, idle worktree', () => expect(why({})).toBeNull())

  it.each([
    ['the main worktree', { isMain: true }],
    ['this session is working in it', { isCurrent: true }],
    ['its path is not one', { isSafe: false }],
    ['bare', { isBare: true }],
    ['its directory is gone', { isPrunable: true }],
    ['locked', { isLocked: true }],
    ['outside', { path: '/elsewhere/wt' }],
    ['not known whether', { dirty: null }],
    ['3 changed or untracked files', { dirty: 3 }],
    ['1 changed or untracked file', { dirty: 1 }],
    [`${DIRTY_CAP}+ changed`, { dirty: DIRTY_CAP }],
    ['origin/main is not known', { ahead: null }],
    ['2 commits not in origin/main', { ahead: 2 }],
    ['1 commit not in origin/main', { ahead: 1 }],
    ['its age is not known', { createdMs: null }],
    ['made less than a day ago', { createdMs: NOW - MIN_AGE_MS + 1 }],
    ['still running', { maker: { run: 'r', agent: 'a1', isRunning: true, how: 'recorded' as const } }],
  ])('keeps it when: %s', (word, over) => expect(why(over)).toContain(word))

  it('keeps one that is a day old to the millisecond (the boundary is inclusive of exactly a day)', () => {
    expect(why({ createdMs: NOW - MIN_AGE_MS })).toBeNull()
    expect(why({ createdMs: NOW - MIN_AGE_MS + 1 })).not.toBeNull()
  })

  it('keeps it with a live process, and when the processes were not checked or not checked for it', () => {
    expect(why({}, okCheck([wt('x')], { [wt('x')]: 1 }))).toBe('1 live process in it')
    expect(why({}, okCheck([wt('x')], { [wt('x')]: 1, [`${wt('x')}/deep`]: 1 }))).toBe('2 live processes in it')
    expect(whyKept(row(), read, null, NOW)).toBe('live processes not checked yet')
    expect(why({}, okCheck([wt('other')]))).toBe('live processes not checked for this one')
    expect(why({}, parseProcs('', [wt('x')], NOW))).toMatch(/blind/)
  })

  it('keeps everything when origin/main is missing', () => expect(why({}, check, { ...read, hasRef: false })).toMatch(/origin\/main is not known/))
})

describe('the removal plan', () => {
  const rows = [row({ path: wt('a') }), row({ path: wt('b'), dirty: 1 }), row({ path: wt('c') })]
  const paths = rows.map(r => r.path)

  it('lists the qualifying worktrees and why each other is kept', () => {
    const plan = planRemoval(readOf(rows), okCheck(paths), NOW)

    expect(plan.targets.map(t => t.path)).toEqual([wt('a'), wt('c')])
    expect(plan.kept).toEqual([{ path: wt('b'), why: '1 changed or untracked file' }])
    expect(plan.blocked).toBeNull()
  })

  it('plans nothing without a read, without a process check, with a blind one, or with one older than two minutes', () => {
    expect(planRemoval(null, null, NOW).blocked).toMatch(/not read/)
    expect(planRemoval(readOf(rows), null, NOW).blocked).toMatch(/not checked/)
    expect(planRemoval(readOf(rows), parseProcs('', paths, NOW), NOW).targets).toEqual([])
    expect(planRemoval(readOf(rows), okCheck(paths, {}, NOW - PROCS_FRESH_MS - 1), NOW).targets).toEqual([])
    expect(planRemoval(readOf(rows), okCheck(paths, {}, NOW - PROCS_FRESH_MS), NOW).targets).toHaveLength(2)
  })

  it('takes at most REMOVE_MAX and says how many wait', () => {
    const many = Array.from({ length: REMOVE_MAX + 3 }, (_, i) => row({ path: wt(`w${i}`) }))
    const plan = planRemoval(readOf(many), okCheck(many.map(r => r.path)), NOW)

    expect(plan.targets).toHaveLength(REMOVE_MAX)
    expect(plan.more).toBe(3)
  })

  it('says so when nothing qualifies', () => expect(planRemoval(readOf([row({ dirty: 2 })]), okCheck([wt('x')]), NOW).blocked).toBe('nothing is both merged and clean'))
})

describe('who made a worktree', () => {
  const agent = (over: Partial<WfAgent>): WfAgent => ({ id: 'a362131950d43961b', label: 'build:x', phase: 'Build', state: 'done', hasWorktree: true, ...over })
  const run = (agents: WfAgent[]): WfRun => ({ id: 'wf1', name: 'big-run', kind: 'workflow', state: 'completed', phases: [{ title: 'Build', agents, done: 1, total: 1, running: 0, failed: 0 }], running: 0, done: 1, failed: 0, idle: 0, total: 1, totalTokens: null, isTokensPartial: false, hasRecord: false })

  it('matches the path the agent recorded, then a directory or branch named agent-<id>, and otherwise says nothing', () => {
    expect(makerOf({ path: wt('x'), branch: null }, [run([agent({ worktreePath: wt('x') })])])).toMatchObject({ run: 'big-run', agent: 'build:x', how: 'recorded' })
    expect(makerOf({ path: wt('agent-a362131950d43961b'), branch: null }, [run([agent({})])])).toMatchObject({ how: 'by name' })
    expect(makerOf({ path: wt('z'), branch: 'worktree-agent-a362131950d43961b' }, [run([agent({})])])).toMatchObject({ how: 'by name' })
    expect(makerOf({ path: wt('agent-a362131950d43961bXX'), branch: null }, [run([agent({})])])).toBeNull()
    expect(makerOf({ path: wt('other'), branch: 'main' }, [run([agent({})])])).toBeNull()
  })
})

describe('the probes', () => {
  it('uses only fixed argv: git -C <dir> ..., one find, never a shell string', async () => {
    const w = world()

    await readWorktrees(ioOf(w), { cwd: wt('current'), nowMs: NOW, runs: [] })
    await checkProcs(ioOf(w), [wt('old')], NOW)

    expect(w.calls.length).toBeGreaterThan(10)
    for (const argv of w.calls) {
      expect(argv[0] === 'git' ? argv[1] : argv[0]).toMatch(/^(-C|\/usr\/bin\/find)$/)
      expect(argv[0]).toMatch(/^(git|\/usr\/bin\/find)$/)
      expect(argv.join(' ')).not.toMatch(/(^| )(sh|bash|eval)( |$)/)
      expect(argv.every(part => !/[\n\r]/.test(part))).toBe(true)
    }

    expect(PROCS_ARGV.slice(0, 2)).toEqual(['/usr/bin/find', '/proc'])
    expect(PROCS_ARGV.some(part => /^-(exec|execdir|ok|okdir|delete|fprint\w*|fls)$/.test(part))).toBe(false)
    expect(w.calls.filter(argv => argv[0] === 'git').every(argv => argv[1] === '-C' && argv[3] !== '--force')).toBe(true)
  })

  it('reads the whole list, probing each worktree, and flags the one this session is in', async () => {
    const read = await readWorktrees(ioOf(world()), { cwd: `${wt('current')}/sub`, nowMs: NOW, runs: [] })

    expect(read.root).toBe(ROOT)
    expect(read.rows).toHaveLength(9)
    expect(read.rows.find(r => r.path === wt('current'))?.isCurrent).toBe(true)
    expect(read.rows.find(r => r.path === wt('dirty'))?.dirty).toBe(3)
    expect(read.rows.find(r => r.path === wt('ahead'))).toMatchObject({ ahead: 2, behind: 0 })
    expect(read.hasRef).toBe(true)
    expect(read.refAtMs).toBe(Math.floor((NOW - 2 * 3_600_000) / 1000) * 1000)
  })

  it('counts a failed probe as unknown, never as clean or merged', async () => {
    const w = world({ ahead: { [wt('old')]: null }, created: { [wt('old')]: null } })
    const read = await readWorktrees(ioOf(w), { cwd: wt('current'), nowMs: NOW, runs: [] })
    const old = read.rows.find(r => r.path === wt('old')) as WtRow

    expect(old).toMatchObject({ ahead: null, createdMs: null })
    expect(whyKept(old, read, okCheck([wt('old')]), NOW)).toMatch(/origin\/main is not known/)
  })

  it('probes at most MAX_PROBED and says how many there are; `only` probes one', async () => {
    const many = Array.from({ length: MAX_PROBED + 5 }, (_, i) => block(i === 0 ? ROOT : wt(`w${i}`), `b${i}`)).join('\n\n')
    const read = await readWorktrees(ioOf(world({ list: many })), { cwd: wt('w1'), nowMs: NOW, runs: [] })

    expect(read.rows).toHaveLength(MAX_PROBED)
    expect(read.total).toBe(MAX_PROBED + 5)
    expect(BATCH).toBeGreaterThan(1)

    const one = await readWorktrees(ioOf(world()), { cwd: wt('current'), nowMs: NOW, runs: [], only: wt('old') })

    expect(one.rows.map(r => r.path)).toEqual([wt('old')])
    expect(one.rows[0]?.isMain).toBe(false)
  })

  it('throws a plain reason when git does not answer or there is no usable directory', async () => {
    await expect(readWorktrees({ run: async () => ({ stdout: '', stderr: 'fatal', exitCode: 128 }), stat: async () => undefined }, { cwd: '/x', nowMs: NOW, runs: [] })).rejects.toThrow(/did not list/)
    await expect(readWorktrees(ioOf(world()), { cwd: '', nowMs: NOW, runs: [] })).rejects.toThrow(/working directory/)
    await expect(readWorktrees(ioOf(world()), { cwd: '/a/../b', nowMs: NOW, runs: [] })).rejects.toThrow(/working directory/)
  })

  it('treats a missing origin/main as unknown for every worktree', async () => {
    const read = await readWorktrees(ioOf(world({ hasRef: false })), { cwd: wt('current'), nowMs: NOW, runs: [] })

    expect(read.hasRef).toBe(false)
    expect(read.rows.every(r => whyKept(r, read, okCheck(read.rows.map(x => x.path)), NOW) !== null)).toBe(true)
  })
})

